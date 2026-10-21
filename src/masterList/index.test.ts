import { afterEach, expect, it, vi } from "vitest";
import { getMasterList, getMasterListEvents, previewMasterList, refreshMasterList, replaceMasterList, uploadMasterList } from "./index";
const list = { id: "1", version: "v1", file: "prices.xlsx", uploadedAt: "2026-10-21", items: [{ name: "Bolt", price: "1.20", quantity: "10", supplier: null }], supplierCount: 0 };
afterEach(() => vi.unstubAllGlobals());
it("uploads actual files and selected mappings, and publishes server rows", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(list))).mockResolvedValueOnce(new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const file = new File(["workbook"], "prices.xlsx");
  const options = { sheet: "Prices", header: 2, mapping: { name: 0, price: 3, quantity: 1 } };
  expect(await uploadMasterList(file, options)).toEqual({ ok: true, list });
  const request = fetch.mock.calls[0][1];
  expect(request.method).toBe("POST");
  expect(request.body.get("file").name).toBe("prices.xlsx");
  expect(JSON.parse(request.body.get("options"))).toEqual(options);
  expect(getMasterList()).toEqual(list);
});
it("keeps the saved list when replacement validation fails", async () => {
  const before = getMasterList();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Row 2: quantity is required" }), { status: 422 })));
  expect(await replaceMasterList(new File(["bad"], "bad.csv"))).toEqual({ ok: false, reason: "Row 2: quantity is required" });
  expect(getMasterList()).toEqual(before);
});
it("loads persistent rows and history from the backend", async () => {
  const history = [{ kind: "uploaded", file: "prices.xlsx", at: "2026-10-21", items: 1, suppliers: 0 }];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(list))).mockResolvedValueOnce(new Response(JSON.stringify(history))));
  await refreshMasterList();
  expect(getMasterList()).toEqual(list);
  expect(getMasterListEvents()).toEqual(history);
});
it("previews Excel through the backend instead of returning seed rows", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheets: [] })));
  vi.stubGlobal("fetch", fetch);
  expect(await previewMasterList(new File(["xls"], "prices.xls"))).toEqual({ sheets: [] });
  expect(fetch.mock.calls[0][0]).toContain("/master-list/preview");
});
