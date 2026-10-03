import { describe, expect, it } from "vitest";
import { harbourPo } from "@/test/po";
import { buildLists } from "@/sample/lists";
import { PRODUCTS, seed } from "@/sample";
import type { Alias, Order } from "@/sample";
import { toRows, validate } from "@/lib/importer";
import {
  buildPayload,
  cellsToFill,
  copyTable,
  duplicateDetail,
  dupNotice,
  exportColumns,
  exportRows,
  keepManual,
  pickSku,
  proposeAlias,
  readDetail,
  splitByName,
  type ReadOrder,
} from "./add-orders";

const lists = buildLists();
const rowsOf = (id = "f1") => toRows([{ sourceId: id, order: harbourPo() }], lists);
const read = (over: Partial<ReadOrder> = {}): ReadOrder => ({
  fileId: "f1",
  fileName: "PO_HH-2240.pdf",
  size: 1000,
  readerId: "buynow",
  fingerprints: { fileHash: "aa11", contentHash: "c0ffee" },
  order: harbourPo(),
  ...over,
});

describe("staging files", () => {
  it("skips names already queued or repeated in the same drop", () => {
    const r = splitByName([{ name: "a.pdf" }], [{ name: "a.pdf" }, { name: "b.pdf" }, { name: "b.pdf" }]);
    expect(r.fresh.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(r.dup).toBe(2);
    expect(dupNotice(1)).toBe("1 duplicate file was skipped");
    expect(dupNotice(2)).toBe("2 duplicate files were skipped");
    expect(dupNotice(0)).toBe("");
  });
});

describe("the duplicate check", () => {
  const s = seed();
  it("finds the same content read earlier in this batch", () => {
    expect(duplicateDetail("c0ffee", [read()], s.orders, s.events)).toBe("Same content as HH-2240 · skipped");
  });
  it("finds the same content on a confirmed order, with its confirm time", () => {
    const orders: Order[] = s.orders.map((o) => (o.id === "o1" ? { ...o, file: { ...o.file!, contentHash: "beef" } } : o));
    expect(duplicateDetail("beef", [], orders, s.events)).toBe("Same content as HH-2231, confirmed 09:40 · skipped");
  });
  it("lets new content through", () => {
    expect(duplicateDetail("new", [read()], s.orders, s.events)).toBeNull();
  });
});

describe("file details", () => {
  it("counts one cell to fill per SKU pick, not per empty column", () => {
    const rows = rowsOf();
    expect(cellsToFill(validate(rows).blockers)).toBe(1);
    expect(readDetail("Buynow", 3, 0)).toBe("Buynow · 3 rows");
    expect(readDetail("Pavilion", 2, 1)).toBe("Pavilion · 2 rows, 1 cell to fill");
  });
});

describe("filling a cell", () => {
  it("picking a SKU fills SKU, SKU Lookup and Price, and Total follows", () => {
    const row = pickSku(rowsOf()[2], PRODUCTS["EGC-EFMX"]);
    expect(row.cells.sku).toMatchObject({ value: "EGC-EFMX", origin: "manual" });
    expect(row.cells.skuLookup.value).toBe("Edible flower mix 50g");
    expect(row.cells.total.value).toBe(9.8);
    expect(validate([row]).blockers).toEqual([]);
  });

  it("proposes an alias for the printed wording, or re-points an existing one", () => {
    const start: Alias[] = [{ text: "Edible flower mix (tray)", sku: null, state: "proposed", by: null, seen: "RC-0917" }];
    expect(proposeAlias(start, "Edible flower mix (tray)", "EGC-EFMX", "HH-2240")).toEqual([{ text: "Edible flower mix (tray)", sku: "EGC-EFMX", state: "proposed", by: null, seen: "RC-0917" }]);
    expect(proposeAlias([], "flower tray", "EGC-EFMX", "HH-2240")).toEqual([{ text: "flower tray", sku: "EGC-EFMX", state: "proposed", by: null, seen: "HH-2240" }]);
  });

  it("keeps the reviewer's values when rows are mapped again", () => {
    const before = rowsOf().map((r, i) => (i === 2 ? pickSku(r, PRODUCTS["EGC-EFMX"]) : r));
    const again = keepManual(before, rowsOf());
    expect(again[2].cells.sku.value).toBe("EGC-EFMX");
    expect(again[0].cells.sku.origin).toBe("master-data");
  });
});

describe("what leaves the screen", () => {
  const visible = ["Sheet", "SKU", "Quantity", "Price", "Total", "PO Number", "Sales Notes"];
  it("drops Sheet always and money for people who cannot see prices", () => {
    expect(exportColumns(visible, true)).toEqual(["sku", "quantity", "price", "total", "poNumber", "salesNotes"]);
    expect(exportColumns(visible, false)).toEqual(["sku", "quantity", "poNumber", "salesNotes"]);
  });

  it("copies no price for people who cannot see prices", () => {
    const rows = rowsOf();
    expect(rows[1].cells.salesNotes.value).toBe("PO price 4.50"); // the PO prints a price that differs from the list
    const priced = copyTable(rows, visible, true);
    const plain = copyTable(rows, visible, false);
    expect(priced).toContain("5.40");
    expect(priced).toContain("PO price 4.50");
    // The header is the on-screen column names, as the prototype copies it, Sheet included.
    expect(plain.split("\n")[0]).toBe("Sheet\tSKU\tQuantity\tPO Number\tSales Notes");
    expect(priced.split("\n")[0]).toBe("Sheet\tSKU\tQuantity\tPrice\tTotal\tPO Number\tSales Notes");
    expect(priced.split("\n")[1].split("\t")[0]).toBe("HH-2240");
    expect(plain).not.toMatch(/\d+\.\d\d/);
    expect(exportRows(rows, false)[1].cells.salesNotes.value).toBeNull();
  });
});

describe("the confirm payload", () => {
  it("carries rows and fingerprints only, keyed by customer and PO", async () => {
    const rows = rowsOf().map((r, i) => (i === 2 ? pickSku(r, PRODUCTS["EGC-EFMX"]) : r));
    const p = await buildPayload([read()], rows);
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0].businessKey).toBe("C10243|HH-2240");
    expect(p.orders[0].fingerprints).toEqual({ fileHash: "aa11", contentHash: "c0ffee" });
    expect(Object.keys(p.orders[0]).sort()).toEqual(["businessKey", "fingerprints", "readerId", "rows", "source"]);
  });

  it("leaves out a read order whose rows are gone", async () => {
    expect((await buildPayload([read()], [])).orders).toEqual([]);
  });
});
