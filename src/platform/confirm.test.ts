import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPayload, pickSku, type ReadOrder } from "@/lib/add-orders";
import { readPaste, readPdf, toRows } from "@/lib/importer";
import { PRODUCTS, seed } from "@/sample";
import { buildLists } from "@/sample/lists";
import { harbourPo } from "@/test/po";
import { confirmedFrom } from "./confirm";

describe("the demo confirm", () => {
  it("turns the payload into confirmed orders in the seeded shape, with the prototype's events", async () => {
    const order = harbourPo();
    const rows = toRows([{ sourceId: "f1", order }], buildLists()).map((r, i) => (i === 2 ? pickSku(r, PRODUCTS["EGC-EFMX"]) : r));
    const read: ReadOrder = { fileId: "f1", fileName: "PO_HH-2240.pdf", size: 4321, readerId: "buynow", fingerprints: { fileHash: "abcdef0123", contentHash: "c0ffee" }, order };
    const payload = await buildPayload([read], rows);
    const s = seed();
    const out = confirmedFrom(payload, s, { by: "Eunice", at: "2026-10-01 14:05", sizes: { "PO_HH-2240.pdf": 4321 } });

    expect(out.seq).toBe(s.seq + 1);
    expect(out.orders).toEqual([
      {
        id: "o101",
        cust: "C10243",
        po: "HH-2240",
        date: "2026-10-05",
        state: "confirmed",
        source: "pdf",
        exported: true,
        confirmedBy: "Eunice",
        file: { name: "PO_HH-2240.pdf", size: 4321, at: "2026-10-01 14:05", hash: "abcdef01", contentHash: "c0ffee", layout: "Buynow" },
        lines: [
          { sku: "EGC-PTND", qty: 4, unit: "box", outlet: "Banquet kitchen", origin: "po" },
          { sku: "EGC-MBAS", qty: 2, unit: "box", outlet: "Banquet kitchen", origin: "po" },
          { sku: "EGC-EFMX", qty: 1, unit: "box", outlet: "Room service", origin: "manual" },
        ],
      },
    ]);
    expect(out.events.map((e) => [e.kind, e.actor, e.text])).toEqual([
      ["read", "Reader", "Read PO HH-2240 (Buynow layout) · 3 lines"],
      ["confirmed", "Eunice", "Confirmed 3 lines"],
      ["exported", "Eunice", "Exported to Excel"],
    ]);
    expect(out.history).toHaveLength(3);
  });

  it("confirms a pasted WhatsApp order under its generated reference", async () => {
    const { order, unparsed } = readPaste("Hi, order for Mon pls\nPea tendrils 4box\nthanks!", { customerId: "C10388", name: "Pavilion Kitchen" }, "2026-10-05");
    const rows = toRows([{ sourceId: "wa1", order }], buildLists());
    expect(unparsed).toEqual(["Hi, order for Mon pls", "thanks!"]);
    expect(rows[0].cells.salesNotes.value).toContain("Hi, order for Mon pls");
    const read: ReadOrder = { fileId: "wa1", fileName: "WhatsApp paste", size: 40, readerId: "whatsapp-paste", fingerprints: { fileHash: null, contentHash: "abc" }, order };
    const out = confirmedFrom(await buildPayload([read], rows), seed(), { by: "Eunice", at: "2026-10-01 14:05", sizes: { "WhatsApp paste": 40 } });
    expect(out.orders[0]).toMatchObject({ cust: "C10388", po: "WA-C10388-0510", source: "whatsapp", lines: [{ sku: "EGC-PTND", qty: 4, unit: "box", outlet: "Main", origin: "po" }] });
    // The source card reads "WhatsApp paste" with the time it was read, as the prototype's parsePaste.
    expect(out.orders[0].file).toEqual({ name: "WhatsApp paste", size: 40, at: "2026-10-01 14:05", hash: "", contentHash: "abc" });
    expect(out.events[0].text).toBe("Read WhatsApp order · 1 lines");
  });

  it("gives a confirmed sample PO the staff's outlet names and the product's unit", async () => {
    const name = "harbour-hotel-hh-2240.pdf";
    const result = await readPdf(name, new Uint8Array(readFileSync(`node_modules/po-importer/fixtures/egc/shangri-la/${name}`)));
    if (result.status !== "parsed" && result.status !== "partial") throw new Error(result.status);
    const rows = toRows([{ sourceId: "f1", order: result.order }], buildLists());
    const read: ReadOrder = { fileId: "f1", fileName: name, size: 9395, readerId: result.readerId, fingerprints: result.fingerprints, order: result.order };
    const out = confirmedFrom(await buildPayload([read], rows), seed(), { by: "Eunice", at: "2026-10-01 14:05", sizes: { [name]: 9395 } });
    const lines = out.orders[0].lines;
    expect([...new Set(lines.map((l) => l.outlet))]).toEqual(["Banquet kitchen", "Room service"]);
    expect([...new Set(lines.map((l) => l.unit))]).toEqual(["box"]);
    expect(out.orders[0].file?.layout).toBe("Shangri-La");
  });
});
