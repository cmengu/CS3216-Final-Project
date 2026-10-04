import type { Alias, LineOrigin, Message, Order, OrderEvent, OrderLine, SourceFile, ToCheck } from "./types";

/* Invented orders, events, messages and review items, as the prototype seeds them. */

const L = (sku: string | null, qty: number, unit: string, outlet: string, origin: LineOrigin = "po"): OrderLine => ({
  sku,
  qty,
  unit,
  outlet,
  origin,
});
// The prototype draws a random fingerprint; fixed invented values keep the seed deterministic.
const F = (name: string, size: number, at: string, hash: string): SourceFile => ({ name, size, at, hash });

/**
 * HH-2231's fingerprints, as the importer's demo set records them for PO_HH-2231.pdf
 * (fixtures/egc/demo-set/fingerprints.json; src/sample/orders.test.ts checks they still match).
 * Reading that file again on Add orders then comes back Duplicate of this order.
 */
export const HH2231_FINGERPRINTS = {
  fileHash: "c98e3e5dff1a6d4cd885fa620b110f67de5659e57b0630e915b3990f08f3313f",
  contentHash: "f0852ebae8fe330faa9a1cfa83614bba6adf32c6224a0e9d21c5dd4e1b86fb1d",
};

export function seedOrders(): Order[] {
  const orders: Order[] = [
    { id: "o1", cust: "C10243", po: "HH-2231", date: "2026-10-02", state: "confirmed", source: "pdf", exported: true, confirmedBy: "Eunice", file: { ...F("PO_HH-2231.pdf", 188416, "2026-10-01 09:12", "3fa1c09e"), ...HH2231_FINGERPRINTS }, lines: [L("EGC-PTND", 4, "box", "Banquet kitchen"), L("EGC-MBAS", 2, "box", "Banquet kitchen"), L("EGC-RVSO", 2, "box", "Banquet kitchen"), L("EGC-NAST", 1, "box", "Room service"), L("EGC-EFMX", 1, "box", "Room service"), L("EGC-WOOD", 1, "box", "Room service")] },
    { id: "o2", cust: "C10310", po: "4810286013", date: "2026-10-02", state: "needs_check", source: "pdf", exported: true, confirmedBy: "Eunice", file: F("4810286013.pdf", 96256, "2026-09-30 16:02", "b27e5d14"), lines: [L("EGC-PTND", 6, "box", "Kitchen #1"), L("EGC-MBAS", 4, "box", "Kitchen #1"), L("EGC-ELDF", 2, "box", "Madame Fan"), L("EGC-EFMX", 2, "box", "Room service")] },
    { id: "o3", cust: "C10388", po: null, date: "2026-10-01", state: "confirmed", source: "whatsapp", exported: true, confirmedBy: "Eunice", lines: [L("EGC-ELDF", 2, "box", "Main"), L("EGC-MBAS", 2, "box", "Main"), L("EGC-NAST", 1, "box", "Main")] },
    { id: "o4", cust: "C10402", po: "RC-0917", date: "2026-10-05", state: "blocked", source: "pdf", exported: false, confirmedBy: null, file: F("RC-0917_Ariba.pdf", 412000, "2026-10-01 08:30", "e8d0a771"), lines: [L("EGC-PTND", 3, "box", "Clubhouse"), { ...L(null, 2, "tray", "Clubhouse", "unresolved"), desc: "Edible flower mix (tray)" }] },
    { id: "o5", cust: "C10419", po: "OD-2210", date: "2026-10-01", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", file: F("OD-2210.pdf", 74000, "2026-09-30 08:50", "5c93f2ab"), lines: [L("EGC-WOOD", 2, "box", "Shop"), L("EGC-RVSO", 1, "box", "Shop")] },
    { id: "o6", cust: "C10243", po: "HH-2225", date: "2026-09-29", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-014", file: F("PO_HH-2225.pdf", 181000, "2026-09-28 09:02", "71ad40c6"), lines: [L("EGC-PTND", 4, "box", "Banquet kitchen"), L("EGC-MBAS", 2, "box", "Banquet kitchen")] },
    { id: "o7", cust: "C10310", po: "4810285990", date: "2026-09-28", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", file: F("4810285990.pdf", 95000, "2026-09-25 10:10", "d4e61b38"), lines: [L("EGC-PTND", 6, "box", "Kitchen #1"), L("EGC-ELDF", 2, "box", "Madame Fan")] },
    { id: "o8", cust: "C10243", po: "HH-2219", date: "2026-09-25", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-011", file: F("PO_HH-2219.pdf", 180200, "2026-09-24 09:05", "0b9fc2e5"), lines: [L("EGC-PTND", 4, "box", "Banquet kitchen"), L("EGC-RVSO", 2, "box", "Banquet kitchen"), L("EGC-WOOD", 1, "box", "Room service")] },
    { id: "o9", cust: "C10388", po: null, date: "2026-09-24", state: "delivered", source: "whatsapp", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-010", lines: [L("EGC-ELDF", 2, "box", "Main"), L("EGC-MBAS", 1, "box", "Main")] },
    { id: "o10", cust: "C10310", po: "4810285812", date: "2026-09-21", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-008", file: F("4810285812.pdf", 94100, "2026-09-18 10:00", "9a27e803"), lines: [L("EGC-PTND", 6, "box", "Kitchen #1"), L("EGC-MBAS", 4, "box", "Kitchen #1"), L("EGC-EFMX", 2, "box", "Room service")] },
    { id: "o11", cust: "C10243", po: "HH-2210", date: "2026-09-18", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-006", file: F("PO_HH-2210.pdf", 179000, "2026-09-17 09:10", "c61f8e29"), lines: [L("EGC-PTND", 4, "box", "Banquet kitchen"), L("EGC-MBAS", 2, "box", "Banquet kitchen"), L("EGC-NAST", 1, "box", "Room service")] },
    { id: "o12", cust: "C10243", po: "HH-2203", date: "2026-09-11", state: "delivered", source: "pdf", exported: true, confirmedBy: "Eunice", invoiced: "INV-2609-003", file: F("PO_HH-2203.pdf", 178500, "2026-09-10 09:00", "47b3d6f0"), lines: [L("EGC-PTND", 3, "box", "Banquet kitchen"), L("EGC-MBAS", 2, "box", "Banquet kitchen")] },
  ];
  return orders;
}

const E = (order: string, at: string, kind: string, actor: string, text: string): OrderEvent => ({ order, at, kind, actor, text });

export function seedEvents(): OrderEvent[] {
  return [
    E("o12", "2026-09-10 09:00", "read", "Reader", "Read PO HH-2203 (Buynow layout)"), E("o12", "2026-09-10 09:15", "confirmed", "Eunice", "Confirmed 2 lines"), E("o12", "2026-09-11 11:20", "delivered", "Mei", "Marked delivered"), E("o12", "2026-09-12 10:00", "invoiced", "Farah", "Invoiced INV-2609-003"),
    E("o11", "2026-09-17 09:10", "read", "Reader", "Read PO HH-2210 (Buynow layout)"), E("o11", "2026-09-17 09:30", "confirmed", "Eunice", "Confirmed 3 lines"), E("o11", "2026-09-18 11:10", "delivered", "Mei", "Marked delivered"), E("o11", "2026-09-19 10:00", "invoiced", "Farah", "Invoiced INV-2609-006"),
    E("o10", "2026-09-18 10:00", "read", "Reader", "Read PO 4810285812 (Marina platform)"), E("o10", "2026-09-18 10:20", "confirmed", "Eunice", "Confirmed 3 lines"), E("o10", "2026-09-21 10:30", "delivered", "Mei", "Marked delivered"), E("o10", "2026-09-22 10:00", "invoiced", "Farah", "Invoiced INV-2609-008"),
    E("o9", "2026-09-23 15:10", "read", "Reader", "Parsed WhatsApp order from Chef Ravi · 2 lines"), E("o9", "2026-09-23 15:20", "confirmed", "Eunice", "Confirmed 2 lines"), E("o9", "2026-09-24 14:00", "delivered", "Mei", "Marked delivered"), E("o9", "2026-09-26 10:00", "invoiced", "Farah", "Invoiced INV-2609-010"),
    E("o8", "2026-09-24 09:05", "read", "Reader", "Read PO HH-2219 (Buynow layout)"), E("o8", "2026-09-24 09:25", "confirmed", "Eunice", "Confirmed 3 lines"), E("o8", "2026-09-25 11:30", "delivered", "Mei", "Marked delivered"), E("o8", "2026-09-26 10:05", "invoiced", "Farah", "Invoiced INV-2609-011"),
    E("o6", "2026-09-28 09:02", "read", "Reader", "Read PO HH-2225 (Buynow layout)"), E("o6", "2026-09-28 09:20", "confirmed", "Eunice", "Confirmed 2 lines"), E("o6", "2026-09-28 09:21", "exported", "Eunice", "Exported to Excel"), E("o6", "2026-09-29 11:40", "delivered", "Mei", "Marked delivered"), E("o6", "2026-09-30 10:00", "invoiced", "Farah", "Invoiced INV-2609-014"),
    E("o7", "2026-09-25 10:10", "read", "Reader", "Read PO 4810285990 (Marina platform)"), E("o7", "2026-09-25 10:31", "confirmed", "Eunice", "Confirmed 2 lines"), E("o7", "2026-09-28 10:05", "delivered", "Mei", "Marked delivered"),
    E("o5", "2026-09-30 08:50", "read", "Reader", "Read PO OD-2210 (Nomni layout)"), E("o5", "2026-09-30 09:12", "confirmed", "Eunice", "Confirmed 2 lines"), E("o5", "2026-09-30 09:13", "exported", "Eunice", "Copied for the packing email"), E("o5", "2026-10-01 08:15", "delivered", "Mei", "Marked delivered"),
    E("o3", "2026-09-30 15:40", "read", "Reader", "Parsed WhatsApp order from Chef Ravi · 3 lines"), E("o3", "2026-09-30 15:44", "confirmed", "Eunice", "Confirmed 3 lines · deliver Thu"), E("o3", "2026-09-30 15:45", "exported", "Eunice", "Exported to Excel"),
    E("o1", "2026-10-01 09:12", "read", "Reader", "Read PO HH-2231 (Buynow layout) · 6 lines, 2 outlets"), E("o1", "2026-10-01 09:40", "confirmed", "Eunice", "Confirmed 6 lines"), E("o1", "2026-10-01 09:41", "exported", "Eunice", "Exported to Excel · sheet HH-2231"), E("o1", "2026-10-01 11:05", "message_linked", "Rule", "Linked a WhatsApp message from Chef Lim"),
    E("o2", "2026-09-30 16:02", "read", "Reader", "Read PO 4810286013 (Marina platform) · 4 lines, 3 outlets"), E("o2", "2026-09-30 16:20", "confirmed", "Eunice", "Confirmed 4 lines"), E("o2", "2026-09-30 16:21", "exported", "Eunice", "Exported to Excel"), E("o2", "2026-10-01 10:48", "received_again", "Reader", "PO 4810286013 received again with different content"), E("o2", "2026-10-01 10:48", "revision_proposed", "Reader", "Set Needs check · line 1 qty 4 → 6 (Kitchen #1)"),
    E("o4", "2026-10-01 08:30", "read", "Reader", "Read PO RC-0917 (Ariba layout) · 2 lines"), E("o4", "2026-10-01 08:31", "blocked", "Reader", "Set Blocked · no SKU match on line 2"),
  ];
}

export function seedMessages(): Message[] {
  return [
    { id: "m1", order: "o1", at: "2026-10-01 11:05", from: "Chef Lim", source: "WhatsApp", text: "Pls send invoice to accounts@ this time thx", linkedBy: "rule" },
    { id: "m2", order: "o2", at: "2026-10-01 10:40", from: "Ms Tan", source: "Email", text: "Revised PO attached, kitchen 1 needs 6 boxes pea tendrils not 4.", linkedBy: "rule" },
  ];
}

export function seedToCheck(): ToCheck[] {
  return [
    { id: "t1", kind: "revision", order: "o2", diff: [{ line: 0, field: "Qty", old: "4", new: "6", outlet: "Kitchen #1" }], from: "Revised PO · 10:48" },
    { id: "t2", kind: "cell", order: "o4", text: "Line 2 · no SKU match for “Edible flower mix (tray)”" },
  ];
}

export function seedAliases(): Alias[] {
  return [
    { text: "pea tendrils", sku: "EGC-PTND", state: "approved", by: "Eunice" },
    { text: "micro basil", sku: "EGC-MBAS", state: "approved", by: "Eunice" },
    { text: "sorrel red", sku: "EGC-RVSO", state: "approved", by: "Eunice" },
    { text: "nasturtium var.", sku: "EGC-NAST", state: "approved", by: "May" },
    { text: "EF mix", sku: "EGC-EFMX", state: "approved", by: "Eunice" },
    { text: "elderflower 30", sku: "EGC-ELDF", state: "approved", by: "Eunice" },
    { text: "star flower", sku: "EGC-ESFR", state: "approved", by: "Eunice" },
    { text: "wood sorrel", sku: "EGC-WOOD", state: "approved", by: "Eunice" },
    { text: "Edible flower mix (tray)", sku: null, state: "proposed", by: null, seen: "RC-0917" },
  ];
}
