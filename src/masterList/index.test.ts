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
  expect(request.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
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
  expect(fetch.mock.calls[0][1].headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
});

it("never lets an older read overwrite a successful replacement", async () => {
  let finishOldRead!: (response: Response) => void;
  const oldRead = new Promise<Response>((resolve) => { finishOldRead = resolve; });
  const updated = { ...list, id: "new", version: "v2" };
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "PUT") return Promise.resolve(Response.json(updated));
    if (url.endsWith("/events")) return Promise.resolve(Response.json([]));
    return oldRead;
  }));
  const pending = refreshMasterList(true);
  expect((await replaceMasterList(new File(["new"], "prices.csv"))).ok).toBe(true);
  expect(getMasterList()?.version).toBe("v2");
  finishOldRead(Response.json(list));
  await pending;
  expect(getMasterList()?.version).toBe("v2");
});

it("keeps the latest refresh when reads finish in reverse order", async () => {
  let finishOldRead!: (response: Response) => void;
  const oldRead = new Promise<Response>((resolve) => { finishOldRead = resolve; });
  const updated = { ...list, version: "v3" };
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/events")) return Promise.resolve(Response.json([]));
    return ++reads === 1 ? oldRead : Promise.resolve(Response.json(updated));
  }));
  const first = refreshMasterList(true);
  await refreshMasterList(true);
  finishOldRead(Response.json(list));
  await first;
  expect(getMasterList()?.version).toBe("v3");
});

it("loads fresh master data even if history is unavailable", async () => {
  const updated = { ...list, version: "v4" };
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    expect(options?.cache).toBe("no-store");
    return Promise.resolve(url.endsWith("/events") ? new Response("{}", { status: 500 }) : Response.json(updated));
  }));
  await refreshMasterList(true);
  expect(getMasterList()?.version).toBe("v4");
});

it("serializes replacements so the last submitted file is the last committed version", async () => {
  let finishFirst!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => { finishFirst = resolve; });
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      expect(options.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
      writes.push(((options.body as FormData).get("file") as File).name);
      return writes.length === 1 ? delayed : Promise.resolve(Response.json({ ...list, version: "last" }));
    }
    return Promise.resolve(Response.json([]));
  }));
  const first = replaceMasterList(new File(["first"], "first.csv"));
  const last = replaceMasterList(new File(["last"], "last.csv"));
  await vi.waitFor(() => expect(writes).toEqual(["first.csv"]));
  finishFirst(Response.json({ ...list, version: "first" }));
  await Promise.all([first, last]);
  expect(writes).toEqual(["first.csv", "last.csv"]);
  expect(getMasterList()?.version).toBe("last");
});

it("refreshes a sibling-tab change received while a save is in progress", async () => {
  let finishSave!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => { finishSave = resolve; });
  let started = false;
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      expect(options.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" }); started = true; return delayed; }
    if (url.endsWith("/events")) return Promise.resolve(Response.json([]));
    ++reads;
    return Promise.resolve(Response.json({ ...list, version: "other-tab" }));
  }));
  const pending = replaceMasterList(new File(["new"], "prices.csv"));
  await vi.waitFor(() => expect(started).toBe(true));
  await refreshMasterList(true);
  expect(reads).toBe(0);
  finishSave(Response.json({ ...list, version: "own-save" }));
  await pending;
  await vi.waitFor(() => expect(getMasterList()?.version).toBe("other-tab"));
});
