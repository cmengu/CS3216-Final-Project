/* The draft-orders model on the importer's demo set: the prototype's "use the four sample POs" walk. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { addDrafts, tableRows } from "@/lib/add-orders";
import { readPaste, readPdf, toRows, validate, type EgcPdfResult } from "@/lib/importer";
import { confirmDrafts } from "@/platform/confirm";
import { seed } from "@/sample";
import type { DemoState } from "@/sample";
import SAMPLE_POS from "@/sample/sample-pos.json";
import { afterReload, LOST_BYTES } from "@/state/demo-store";
import { listsOf, pasteOp, pickOp, setQtyOp, settleOp, startOverOp } from "./add";
import { confirmOrder, unconfirm } from "./orders";

const C = { me: "Eunice", at: "2026-10-01 14:05" };
const results = new Map<string, EgcPdfResult>();

beforeAll(async () => {
  for (const name of SAMPLE_POS.files) results.set(name, await readPdf(name, new Uint8Array(readFileSync(`${SAMPLE_POS.folder}/${name}`))));
});

/** Queue and process the sample set, as Add orders does. */
function processed(): DemoState {
  const s = seed();
  s.queue = SAMPLE_POS.files.map((name, i) => ({ id: `q${i}`, name, size: 1, st: "processing", detail: "" }));
  SAMPLE_POS.files.forEach((name, i) => settleOp(s, `q${i}`, results.get(name)!, C.at));
  return s;
}

describe("processing the four sample POs", () => {
  it("reads like the prototype: Ready, Needs review, Duplicate, Unsupported", () => {
    const s = processed();
    expect(s.queue.map((f) => [f.name, f.st, f.detail])).toEqual([
      ["PO_HH-2240_HarbourHotel.pdf", "parsed", "Buynow · 3 rows"],
      ["PO_PK-331_Pavilion.pdf", "partial", "Buynow · 2 rows, 1 cell to fill"],
      ["PO_HH-2231.pdf", "duplicate", "Same content as HH-2231, confirmed 09:40 · skipped"],
      ["slides_week_06.pdf", "unsupported", "This PO layout is not one of the supported customer layouts."],
    ]);
  });

  it("makes two draft orders in the store, with the prototype's ids, customers and lines", () => {
    const s = processed();
    const drafts = addDrafts(s.orders);
    expect(drafts.map((o) => [o.id, o.cust, o.po, o.date, o.state, o.fromAdd])).toEqual([
      ["o101", "C10243", "HH-2240", "2026-10-05", "draft", true],
      ["o102", "C10388", "PK-331", "2026-10-05", "draft", true],
    ]);
    expect(drafts[0].lines.map((l) => [l.sku, l.qty, l.unit, l.outlet, l.origin])).toEqual([
      ["EGC-PTND", 4, "box", "Banquet kitchen", "po"],
      ["EGC-MBAS", 2, "box", "Banquet kitchen", "po"],
      ["EGC-NAST", 1, "box", "Banquet kitchen", "po"],
    ]);
    expect(drafts[1].lines.map((l) => [l.sku, l.qty, l.unit, l.outlet, l.origin, l.desc])).toEqual([
      ["EGC-ELDF", 2, "box", "Main", "po", "Elderflower - 30g"],
      [null, 1, "tray", "Main", "unresolved", "Edible flower mix (tray)"],
    ]);
    // Step 3: "5 rows from 2 POs · highlighted cells need a value".
    expect(tableRows(drafts)).toHaveLength(5);
    expect(validate(tableRows(drafts)).blockers.length).toBeGreaterThan(0);
  });

  it("keeps the rows and fingerprints with the draft, and they survive a reload; the queue's lost bytes are said", () => {
    const s = processed();
    s.queue.push({ id: "q9", name: "later.pdf", size: 10, st: "ready", detail: "Ready to process" });
    const back = afterReload(JSON.parse(JSON.stringify(s)));
    expect(addDrafts(back.orders)).toEqual(addDrafts(s.orders));
    expect(addDrafts(back.orders)[0].read?.fingerprints.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(back.queue.map((f) => f.st)).toEqual(["parsed", "partial", "duplicate", "unsupported", "failed"]);
    expect(back.queue[4].detail).toBe(LOST_BYTES);
  });
});

describe("the table's edits", () => {
  it("pick fills the cell, proposes the alias, and the draft can then be confirmed", () => {
    const s = processed();
    const pk = s.orders.find((o) => o.id === "o102")!;
    expect(confirmOrder(s, C, "o102")).toBe("A cell still has no SKU");
    expect(pickOp(s, "o102", pk.read!.rows[1].id, "EGC-EFMX")).toBe("“Edible flower mix (tray)” → EGC-EFMX · alias proposed");
    expect(s.aliases.find((a) => a.text === "Edible flower mix (tray)")).toMatchObject({ sku: "EGC-EFMX", state: "proposed" });
    expect(validate(tableRows(addDrafts(s.orders))).blockers).toEqual([]);
    setQtyOp(s, "o102", pk.read!.rows[0].id, "3");
    expect(s.orders.find((o) => o.id === "o102")!.lines[0]).toMatchObject({ qty: 3, origin: "manual" });
    // Confirm on the order page (the prototype's confirmOrder): confirmed, out of the table.
    expect(confirmOrder(s, C, "o102")).toBe("Confirmed");
    expect(addDrafts(s.orders).map((o) => o.id)).toEqual(["o101"]);
  });

  it("an approved alias maps the wording on the next read", () => {
    const s = processed();
    const pk = s.orders.find((o) => o.id === "o102")!;
    pickOp(s, "o102", pk.read!.rows[1].id, "EGC-EFMX");
    s.aliases.find((a) => a.text === "Edible flower mix (tray)")!.state = "approved";
    const r = results.get("PO_PK-331_Pavilion.pdf")!;
    if (r.status !== "parsed" && r.status !== "partial") throw new Error(r.status);
    expect(toRows([r.order], listsOf(s))[1].cells.sku.value).toBe("EGC-EFMX");
  });
});

describe("confirm, unconfirm and start over", () => {
  it("Confirm all confirms both drafts; Unconfirm puts one back in the table; Start over removes it", () => {
    const s = processed();
    const pk = s.orders.find((o) => o.id === "o102")!;
    pickOp(s, "o102", pk.read!.rows[1].id, "EGC-EFMX");
    confirmDrafts(s, C, ["o101", "o102"]);
    expect(addDrafts(s.orders)).toEqual([]);
    expect(unconfirm(s, C, "o101")).toBe("Unconfirmed");
    expect(addDrafts(s.orders).map((o) => o.id)).toEqual(["o101"]);
    expect(tableRows(addDrafts(s.orders))).toHaveLength(3);
    startOverOp(s);
    expect(s.orders.some((o) => o.id === "o101")).toBe(false);
    expect(s.orders.some((o) => o.id === "o102" && o.state === "confirmed")).toBe(true);
    expect(s.queue).toEqual([]);
  });

  it("Unconfirm on a seeded order rebuilds its rows for the table", () => {
    const s = seed();
    unconfirm(s, C, "o1");
    const [o1] = addDrafts(s.orders);
    expect(o1.id).toBe("o1");
    expect(o1.read?.rows).toHaveLength(6);
    expect(confirmOrder(s, C, "o1")).toBe("Confirmed");
  });
});

describe("a WhatsApp paste", () => {
  it("maps every line of the prototype's example", () => {
    const s = seed();
    const { order, unparsed } = readPaste("Hi, order for Mon pls\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red x1\nthanks!", { customerId: "C10243", name: "Harbour Hotel" }, "2026-10-05");
    const rows = toRows([{ sourceId: "wa1", order }], listsOf(s));
    pasteOp(s, { sourceId: "wa1", size: 80, at: C.at, readerId: "whatsapp-paste", source: order.source, fingerprints: { fileHash: null, contentHash: "x" }, rows, descs: order.lines.map((l) => l.description), unparsed, date: "2026-10-05" });
    const [o] = addDrafts(s.orders);
    expect(o.lines.map((l) => [l.sku, l.qty])).toEqual([
      ["EGC-PTND", 4],
      ["EGC-RVSO", 2],
      ["EGC-ESFR", 1],
    ]);
    expect(o.unparsed).toEqual(["Hi, order for Mon pls", "thanks!"]);
  });

  it("maps the placeholder's wording too", () => {
    const { order } = readPaste("18/9 Fri\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red-1", { customerId: "C10388" }, "2026-10-05");
    expect(toRows([order], listsOf(seed())).map((r) => r.cells.sku.value)).toEqual(["EGC-PTND", "EGC-RVSO", "EGC-ESFR"]);
  });
});
