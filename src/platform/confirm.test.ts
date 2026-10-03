import { describe, expect, it } from "vitest";
import { draftsFrom } from "@/lib/add-orders";
import { readPaste, toRows } from "@/lib/importer";
import { seed } from "@/sample";
import { buildLists } from "@/sample/lists";
import { harbourPo } from "@/test/po";
import { confirmDrafts } from "./confirm";

const C = { me: "Eunice", at: "2026-10-01 14:05" };

describe("the demo confirm (the prototype's confirmAll)", () => {
  it("confirms the drafts in place, keeps their ids, and records read, confirmed and exported", () => {
    const s = seed();
    const po = harbourPo();
    const made = draftsFrom(
      {
        sourceId: "f1",
        fileName: "PO_HH-2240.pdf",
        size: 4321,
        at: C.at,
        readerId: "buynow",
        readerLabel: "Buynow",
        source: po.source,
        fingerprints: { fileHash: "abcdef0123", contentHash: "c0ffee" },
        rows: toRows([{ sourceId: "f1", order: po }], buildLists()),
        descs: po.lines.map((l) => l.description),
      },
      s,
    );
    s.orders.push(...made.orders);
    confirmDrafts(s, C, ["o101"]);
    const o = s.orders.find((x) => x.id === "o101")!;
    expect(o).toMatchObject({ state: "confirmed", fromAdd: false, confirmedBy: "Eunice", exported: true });
    expect(o.read?.rows).toHaveLength(3);
    expect(s.events.filter((e) => e.order === "o101").map((e) => [e.kind, e.actor, e.text])).toEqual([
      ["read", "Reader", "Read PO HH-2240 (Buynow layout) · 3 lines"],
      ["confirmed", "Eunice", "Confirmed 3 lines"],
      ["exported", "Eunice", "Exported to Excel"],
    ]);
    expect(s.history.filter((h) => h.order === "o101")).toHaveLength(3);
  });

  it("confirms a pasted WhatsApp order under the prototype's WA reference", () => {
    const s = seed();
    const { order, unparsed } = readPaste("Hi, order for Mon pls\nPea tendrils 4box\nthanks!", { customerId: "C10388", name: "Pavilion Kitchen" }, "2026-10-05");
    const rows = toRows([{ sourceId: "wa1", order }], buildLists());
    expect(rows[0].cells.salesNotes.value).toContain("Hi, order for Mon pls");
    const made = draftsFrom(
      { sourceId: "wa1", fileName: "WhatsApp paste", size: 40, at: C.at, readerId: "whatsapp-paste", readerLabel: "WhatsApp", source: order.source, fingerprints: { fileHash: null, contentHash: "abc" }, rows, descs: ["Pea tendrils"], unparsed, date: "2026-10-05" },
      s,
    );
    s.orders.push(...made.orders);
    confirmDrafts(s, C, [made.orders[0].id]);
    const o = s.orders.find((x) => x.id === made.orders[0].id)!;
    expect(o).toMatchObject({ cust: "C10388", po: null, date: "2026-10-05", source: "whatsapp", unparsed, lines: [{ sku: "EGC-PTND", qty: 4, unit: "box", outlet: "Main", origin: "po" }] });
    // The source card reads "WhatsApp paste" with the time it was read, as the prototype's parsePaste.
    expect(o.file).toEqual({ name: "WhatsApp paste", size: 40, at: C.at, hash: "", contentHash: "abc" });
    expect(s.events.find((e) => e.order === o.id)?.text).toBe("Read WhatsApp order · 1 lines");
  });
});
