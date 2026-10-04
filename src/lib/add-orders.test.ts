import { describe, expect, it } from "vitest";
import { harbourPo } from "@/test/po";
import { buildLists } from "@/sample/lists";
import { CUSTOMERS, seed } from "@/sample";
import type { Alias, Order } from "@/sample";
import { HH2231_FINGERPRINTS } from "@/sample/orders";
import { toRows, validate } from "@/lib/importer";
import {
  addDrafts,
  buildPayload,
  cellsToFill,
  copyTable,
  draftsFrom,
  duplicateDetail,
  dupNotice,
  exportColumns,
  pickCustomerIn,
  pickSkuIn,
  proposeAlias,
  readDetail,
  readFor,
  setQtyIn,
  splitByName,
  tableRows,
  type ReadInput,
} from "./add-orders";

const lists = buildLists();
const rowsOf = (id = "f1") => toRows([{ sourceId: id, order: harbourPo() }], lists);
const input = (over: Partial<ReadInput> = {}): ReadInput => {
  const po = harbourPo();
  return {
    sourceId: "f1",
    fileName: "PO_HH-2240.pdf",
    size: 1000,
    at: "2026-10-01 14:05",
    readerId: "buynow",
    readerLabel: "Buynow",
    source: po.source,
    fingerprints: { fileHash: "aa11bb22cc", contentHash: "c0ffee" },
    rows: rowsOf(),
    descs: po.lines.map((l) => l.description),
    ...over,
  };
};
const draft = () => draftsFrom(input(), seed()).orders[0];

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

describe("a read PO is a draft order", () => {
  it("in the seeded orders' shape, with its rows and fingerprints beside it", () => {
    const s = seed();
    const { orders, seq } = draftsFrom(input(), s);
    expect(seq).toBe(s.seq + 1);
    const o = orders[0];
    expect({ ...o, read: undefined }).toEqual({
      id: "o101",
      cust: "C10243",
      po: "HH-2240",
      date: "2026-10-05",
      state: "draft",
      source: "pdf",
      fromAdd: true,
      exported: false,
      confirmedBy: null,
      file: { name: "PO_HH-2240.pdf", size: 1000, at: "2026-10-01 14:05", hash: "aa11bb22", contentHash: "c0ffee", fileHash: "aa11bb22cc", layout: "Buynow" },
      lines: [
        { sku: "EGC-PTND", qty: 4, unit: "box", outlet: "Banquet kitchen", origin: "po", desc: "Pea tendrils" },
        { sku: "EGC-MBAS", qty: 2, unit: "box", outlet: "Banquet kitchen", origin: "po", desc: "Micro basil 50g" },
        { sku: null, qty: 1, unit: "box", outlet: "Room service", origin: "unresolved", desc: "Edible flower mix (tray)" },
      ],
      read: undefined,
    });
    expect(o.read).toEqual({ sourceId: "f1", readerId: "buynow", source: harbourPo().source, fingerprints: { fileHash: "aa11bb22cc", contentHash: "c0ffee" }, rows: rowsOf() });
    // Stored as plain data: it survives JSON, as the store's localStorage key does.
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });

  it("splits a PO whose rows name several customers, and keeps rows with no customer on their own draft", () => {
    const rows = rowsOf();
    rows[2] = { ...rows[2], cells: { ...rows[2].cells, customerId: { value: null, origin: "unresolved" } } };
    const { orders } = draftsFrom(input({ rows }), seed());
    expect(orders.map((o) => [o.cust, o.lines.length])).toEqual([
      ["C10243", 2],
      ["", 1],
    ]);
  });

  it("the Step 3 table is the drafts that came from Add orders, in store order", () => {
    const s = seed();
    const o = draft();
    s.orders.push(o, { ...o, id: "o999", fromAdd: false });
    expect(addDrafts(s.orders).map((x) => x.id)).toEqual(["o101"]);
    expect(tableRows(addDrafts(s.orders))).toHaveLength(3);
  });
});

describe("the duplicate check", () => {
  const s = seed();
  it("finds the demo set's PO_HH-2231.pdf as the seeded HH-2231, with its confirm time", () => {
    expect(duplicateDetail(HH2231_FINGERPRINTS, s.orders, s.events)).toBe("Same content as HH-2231, confirmed 09:40 · skipped");
  });
  it("finds the same content as a draft of this batch", () => {
    const orders: Order[] = [...s.orders, draft()];
    expect(duplicateDetail({ fileHash: "zz", contentHash: "c0ffee" }, orders, s.events)).toBe("Same content as HH-2240 · skipped");
  });
  it("lets new content through", () => {
    expect(duplicateDetail({ fileHash: "new", contentHash: "new" }, s.orders, s.events)).toBeNull();
  });
});

describe("file details", () => {
  it("counts one cell to fill per SKU pick, not per empty column", () => {
    expect(cellsToFill(validate(rowsOf()).blockers)).toBe(1);
    expect(readDetail("Buynow", 3, 0)).toBe("Buynow · 3 rows");
    expect(readDetail("Buynow", 2, 1)).toBe("Buynow · 2 rows, 1 cell to fill");
  });
});

describe("editing a draft", () => {
  it("one pickSku fills the line, the line turns manual, and the draft's lines follow", () => {
    const o = draft();
    pickSkuIn(o, o.read!.rows[2].id, "EGC-EFMX", lists, CUSTOMERS);
    expect(o.read!.rows[2].cells.sku).toMatchObject({ value: "EGC-EFMX", origin: "manual" });
    expect(o.read!.rows[2].cells.skuLookup.value).toBe("Edible flower mix 50g");
    expect(o.read!.rows[2].cells.total.value).toBe(9.8);
    expect(o.lines[2]).toEqual({ sku: "EGC-EFMX", qty: 1, unit: "box", outlet: "Room service", origin: "manual", desc: "Edible flower mix (tray)" });
    expect(validate(o.read!.rows).blockers).toEqual([]);
  });

  it("a typed quantity is at least 1, as the prototype's setQty", () => {
    const o = draft();
    setQtyIn(o, o.read!.rows[0].id, "7", CUSTOMERS);
    expect(o.lines[0]).toMatchObject({ qty: 7, origin: "manual" });
    expect(o.read!.rows[0].cells.total.value).toBe(37.8);
    setQtyIn(o, o.read!.rows[0].id, "0", CUSTOMERS);
    expect(o.lines[0].qty).toBe(1);
  });

  it("picking the customer fills every row with pickCustomer and gives the draft its customer", () => {
    const rows = rowsOf().map((r) => ({ ...r, cells: { ...r.cells, customerId: { value: null, origin: "unresolved" as const }, customer: { value: null, origin: "unresolved" as const } } }));
    const o = draftsFrom(input({ rows }), seed()).orders[0];
    expect(o.cust).toBe("");
    pickCustomerIn(o, "C10243", lists, CUSTOMERS);
    expect(o.cust).toBe("C10243");
    expect(o.read!.rows.map((r) => r.cells.customerId.value)).toEqual(["C10243", "C10243", "C10243"]);
    expect(o.read!.rows[0].cells.customer.value).toBe("Harbour Hotel");
  });

  it("proposes an alias for the printed wording, or re-points an existing one", () => {
    const start: Alias[] = [{ text: "Edible flower mix (tray)", sku: null, state: "proposed", by: null, seen: "RC-0917" }];
    expect(proposeAlias(start, "Edible flower mix (tray)", "EGC-EFMX", "HH-2240")).toEqual([{ text: "Edible flower mix (tray)", sku: "EGC-EFMX", state: "proposed", by: null, seen: "RC-0917" }]);
    expect(proposeAlias([], "flower tray", "EGC-EFMX", "HH-2240")).toEqual([{ text: "flower tray", sku: "EGC-EFMX", state: "proposed", by: null, seen: "HH-2240" }]);
  });
});

describe("an unconfirmed order's rows", () => {
  it("are rebuilt from its lines by the importer when it has none (a seeded order)", () => {
    const s = seed();
    const o1 = s.orders.find((o) => o.id === "o1")!;
    const read = readFor(o1, lists, s.customers);
    expect(read.sourceId).toBe("o1");
    expect(read.fingerprints).toEqual(HH2231_FINGERPRINTS);
    expect(read.rows.map((r) => [r.cells.sku.value, r.cells.quantity.value, r.cells.customerId.value, r.cells.poNumber.value])).toEqual(
      o1.lines.map((l) => [l.sku, l.qty, "C10243", "HH-2231"]),
    );
    expect(read.rows[0].cells.location.value).toBe("Loading dock B");
    expect(validate(read.rows).blockers).toEqual([]);
  });

  it("are the kept rows when they still match its lines", () => {
    const o = draft();
    pickSkuIn(o, o.read!.rows[2].id, "EGC-EFMX", lists, CUSTOMERS);
    expect(readFor(o, lists, CUSTOMERS)).toBe(o.read);
  });
});

describe("what leaves the screen", () => {
  const visible = ["Sheet", "SKU", "Quantity", "Price", "Total", "PO Number", "Sales Notes"];
  it("drops Sheet always and money for people who cannot see prices", () => {
    expect(exportColumns(visible, true)).toEqual(["sku", "quantity", "price", "total", "poNumber", "salesNotes"]);
    expect(exportColumns(visible, false)).toEqual(["sku", "quantity", "poNumber", "salesNotes"]);
  });

  it("copies with the importer's Sheet column, and no price for people who cannot see prices", () => {
    const rows = rowsOf();
    expect(rows[1].cells.salesNotes.value).toBe("PO price 4.50"); // the PO prints a price that differs from the list
    const priced = copyTable(rows, visible, true);
    const plain = copyTable(rows, visible, false);
    expect(priced).toContain("5.40");
    expect(priced).toContain("PO price 4.50");
    // The header is the on-screen column names, as the prototype copies it.
    expect(plain.split("\n")[0]).toBe("Sheet\tSKU\tQuantity\tPO Number\tSales Notes");
    expect(priced.split("\n")[0]).toBe("Sheet\tSKU\tQuantity\tPrice\tTotal\tPO Number\tSales Notes");
    expect(priced.split("\n")[1].split("\t")[0]).toBe("HH-2240");
    expect(plain.split("\n")[1].split("\t")).toHaveLength(5);
    expect(plain).not.toMatch(/\d+\.\d\d/);
    expect(copyTable(rows, visible.slice(1), true).split("\n")[1].split("\t")[0]).toBe("EGC-PTND");
  });
});

describe("the confirm payload", () => {
  it("carries each draft's rows and fingerprints only, keyed by customer and PO", async () => {
    const o = draft();
    pickSkuIn(o, o.read!.rows[2].id, "EGC-EFMX", lists, CUSTOMERS);
    const p = await buildPayload([o]);
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0].businessKey).toBe("C10243|HH-2240");
    expect(p.orders[0].fingerprints).toEqual({ fileHash: "aa11bb22cc", contentHash: "c0ffee" });
    expect(p.orders[0].rows).toBe(o.read!.rows);
    expect(Object.keys(p.orders[0]).sort()).toEqual(["businessKey", "fingerprints", "readerId", "rows", "source"]);
  });
});
