import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPill, queueAttention } from "./present";
import { supersededBy } from "./summary";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { projectRequest } from "./projects";

afterEach(() => vi.unstubAllGlobals());

it("allows a valid null response when a project has no master list yet", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(null)));
  expect(await projectRequest("/master-list")).toBeNull();
});

it("preserves the server cooldown on group availability errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Gateway unavailable", { status: 503, headers: { "Retry-After": "120" } })));
  await expect(projectRequest("/projects")).rejects.toMatchObject({ retryAfter: 120 });
});

const saved: ServiceInvoice = {
  id: "one", project_id: "expenses", comparison_mode: "totals_only",
  filename: "one.pdf", status: "completed", mode: "live", created_at: "2026-11-01T00:00:00Z",
  document_hash: "same", price_sheet_version: "", error: null, check: null,
  invoice: { supplier_name: "Supplier", invoice_number: "1", invoice_date: null,
    currency: "USD", subtotal: "10.00", tax: "0.00", invoice_total: "10.00",
    lines: [{ part_number: null, description: "Travel", quantity: "1", unit_price: "10", line_total: "10" }] },
};

describe("project invoice presentation", () => {
  it("labels an extracted totals-only invoice without claiming it matched a master", () => {
    const invoice = toSupplierInvoice(saved);
    expect(checkPill(invoice).text).toBe("Extracted");
    expect(queueAttention(invoice)).toBeNull();
    expect(invoice.lines[0].sheetPrice).toBeNull();
    expect(invoice.total).toBe(10);
  });
  it("does not hide a failed invoice because the same PDF succeeded in a different project", () => {
    const failed = toSupplierInvoice({ ...saved, status: "failed" });
    const newer = toSupplierInvoice({ ...saved, id: "two", project_id: "another", created_at: "2026-11-02T00:00:00Z" });
    expect(supersededBy(failed, [failed, newer])).toBeNull();
    expect(supersededBy(failed, [failed, { ...newer, projectId: failed.projectId }])?.id).toBe("two");
  });
});
