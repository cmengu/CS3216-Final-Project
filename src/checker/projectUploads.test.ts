import { afterEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { enqueue, resetUploadsSession } from "./uploads";

const record: ServiceInvoice = {
  id: "one", project_id: "one", comparison_mode: "totals_only", filename: "invoice.pdf",
  status: "completed", mode: "live", created_at: "2026-11-01T00:00:00Z",
  price_sheet_version: "", error: null, invoice: null, check: null,
};

afterEach(() => { vi.restoreAllMocks(); resetUploadsSession(); });

it("queues the same PDF for different Outlook destinations and deduplicates within each project", async () => {
  resetUploadsSession();
  const upload = vi.spyOn(api, "uploadInvoice").mockImplementation(async (_file, projectId) =>
    toSupplierInvoice({ ...record, id: projectId!, project_id: projectId }));
  vi.spyOn(api, "rememberInvoice").mockImplementation(() => {});
  const file = new File(["same invoice bytes"], "invoice.pdf", { type: "application/pdf" });
  // These are the per-file assignments submitted by the Outlook destination page.
  enqueue([file], () => [], "project-a");
  enqueue([file], () => [], "project-b");
  enqueue([file], () => [], "project-a");
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  // Allow the third item's duplicate check to finish before resetting the shared queue.
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(upload.mock.calls.map(([, destination]) => destination)).toEqual(["project-a", "project-b"]);
});
