import { afterEach, describe, expect, it, vi } from "vitest";
import { listInvoices } from "./api";
import type { ServiceInvoice } from "./convert";

const id = "11111111-1111-1111-1111-111111111111";

function saved(supplier: string, total: string | null): ServiceInvoice {
  return {
    id,
    filename: "invoice-02.pdf",
    status: "completed",
    mode: "fixture",
    created_at: "2026-10-11T05:00:00+00:00",
    price_sheet_version: "sheet",
    error: null,
    invoice: {
      supplier_name: supplier,
      invoice_number: "DEMO-002",
      invoice_date: "2026-10-02",
      currency: "SGD",
      subtotal: "492.00",
      tax: "44.28",
      invoice_total: "536.28",
      lines: [],
    },
    check: { overcharge_total: total, lines: [] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listInvoices", () => {
  it("reads each summary in full, because a summary has no supplier or overcharge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/invoices")) return new Response(JSON.stringify([{ id }]), { status: 200 });
      return new Response(JSON.stringify(saved("Invented Silicon Trading", "15.00")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await listInvoices();
    expect(list.map((invoice) => invoice.supplier)).toEqual(["Invented Silicon Trading"]);
    expect(list[0].overchargeTotal).toBe(15);
    expect(list[0].fixture).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says the service could not be reached and does not invent invoices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(listInvoices()).rejects.toThrow("The checking service could not be reached.");
  });
});
