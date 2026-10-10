import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { DemoState } from "@/sample";
import {
  addComment,
  approve,
  bulkDeliver,
  confirmOrder,
  deliver,
  dismiss,
  dropDraft,
  fillCell,
  invoice,
  keepOld,
  nowStr,
  sendReply,
  suggest,
  unconfirm,
  viewPrices,
  type Ctx,
} from "./orders";

const C: Ctx = { me: "Eunice", at: "2026-10-01 12:00" };
const order = (s: DemoState, id: string) => s.orders.find((o) => o.id === id)!;
const last = (s: DemoState) => s.events[s.events.length - 1];
const lastH = (s: DemoState) => s.history[s.history.length - 1];

describe("nowStr", () => {
  it("puts the time of day on the demo's fixed today", () => {
    expect(nowStr(new Date(2030, 0, 5, 7, 3))).toBe("2026-10-01 07:03");
  });
});

describe("delivery and invoicing", () => {
  it("marks delivered with one event and one history row", () => {
    const s = seed();
    expect(deliver(s, C, "o1")).toBe("Marked delivered");
    expect(order(s, "o1").state).toBe("delivered");
    expect(last(s)).toEqual({ order: "o1", at: C.at, kind: "delivered", actor: "Eunice", text: "Marked delivered" });
    expect(lastH(s)).toEqual({ at: C.at, who: "Eunice", kind: "delivered", order: "o1", text: "Marked delivered" });
  });

  it("marks several delivered at once", () => {
    const s = seed();
    expect(bulkDeliver(s, C, ["o1", "o3"])).toBe("2 marked delivered");
    expect([order(s, "o1").state, order(s, "o3").state]).toEqual(["delivered", "delivered"]);
    expect(s.events.slice(-2).map((e) => e.order)).toEqual(["o1", "o3"]);
  });

  it("numbers invoices from the sequence", () => {
    const s = seed();
    expect(invoice(s, C, "o5")).toBe("Invoiced INV-2610-200");
    expect(invoice(s, C, "o7")).toBe("Invoiced INV-2610-201");
    expect(order(s, "o5").invoiced).toBe("INV-2610-200");
    expect(s.seq).toBe(102);
  });
});

describe("confirm and unconfirm", () => {
  it("unconfirms back to a draft and drops the order's review items", () => {
    const s = seed();
    expect(unconfirm(s, C, "o2")).toBe("Unconfirmed");
    expect(order(s, "o2")).toMatchObject({ state: "draft" });
    expect(s.toCheck.some((t) => t.order === "o2")).toBe(false);
    expect(last(s).text).toBe("Unconfirmed · already exported, re-send the sheet");
    unconfirm(s, C, "o4");
    expect(last(s).text).toBe("Unconfirmed · back to draft");
  });

  it("refuses to confirm with a missing SKU or with retention off", () => {
    const s = seed();
    order(s, "o4").state = "draft";
    expect(confirmOrder(s, C, "o4")).toBe("A cell still has no SKU");
    expect(order(s, "o4").state).toBe("draft");
    s.settings.retainsRows = false;
    expect(confirmOrder(s, C, "o1")).toBe("Retention is off");
  });

  it("confirms a draft", () => {
    const s = seed();
    unconfirm(s, C, "o1");
    expect(confirmOrder(s, { me: "May", at: C.at }, "o1")).toBe("Confirmed");
    expect(order(s, "o1")).toMatchObject({ state: "confirmed", confirmedBy: "May" });
    expect(last(s)).toMatchObject({ kind: "confirmed", actor: "May", text: "Confirmed 6 lines" });
  });
});

describe("revision review", () => {
  it("approves the new quantity", () => {
    const s = seed();
    order(s, "o2").lines[0].qty = 4;
    expect(approve(s, C, "t1")).toBe("Approved · packing sees 6");
    expect(order(s, "o2").lines[0].qty).toBe(6);
    expect(order(s, "o2").state).toBe("confirmed");
    expect(s.toCheck.map((t) => t.id)).toEqual(["t2"]);
    expect(last(s)).toMatchObject({ kind: "revision_approved", text: "Approved line 1 qty 4 → 6" });
  });

  it("keeps the old quantity with a note", () => {
    const s = seed();
    expect(keepOld(s, C, "t1")).toBe("Kept, noted");
    expect(last(s)).toMatchObject({ kind: "revision_fixed", text: "Kept 4 · “hotel to confirm by phone”" });
  });

  it("needs a reason to dismiss", () => {
    const s = seed();
    expect(dismiss(s, C, "t1", "")).toBe("Pick a reason first");
    expect(order(s, "o2").state).toBe("needs_check");
    expect(dismiss(s, C, "t1", "duplicate")).toBe("Dismissed · duplicate");
    expect(last(s)).toMatchObject({ kind: "revision_dismissed", text: "Dismissed the revision · duplicate" });
    expect(order(s, "o2").state).toBe("confirmed");
  });

  it("fills a missing SKU, proposes the alias and confirms", () => {
    const s = seed();
    expect(fillCell(s, C, "t2", "")).toBe("Pick a SKU");
    expect(fillCell(s, C, "t2", "EGC-EFMX")).toBe("Filled · alias proposed");
    expect(order(s, "o4").lines[1]).toMatchObject({ sku: "EGC-EFMX", origin: "manual" });
    expect(order(s, "o4")).toMatchObject({ state: "confirmed", confirmedBy: "Eunice" });
    expect(s.aliases.find((a) => a.text === "Edible flower mix (tray)")).toMatchObject({ sku: "EGC-EFMX", state: "proposed" });
    expect(last(s).text).toBe("Filled line 2 with EGC-EFMX · alias proposed · confirmed 2 lines");
  });
});

describe("comments and replies", () => {
  it("posts a comment as an event, the text in History, and ignores blanks", () => {
    const s = seed();
    expect(addComment(s, C, "o1", "  ")).toBe("");
    expect(s.comments).toEqual([]);
    expect(addComment(s, C, "o1", " Gate code 4411 ")).toBe("Posted");
    expect(s.comments).toEqual([{ order: "o1", at: C.at, who: "Eunice", text: "Gate code 4411" }]);
    expect(last(s)).toMatchObject({ kind: "comment", text: "Commented" });
    expect(lastH(s)).toMatchObject({ kind: "comment", text: "Gate code 4411" });
  });

  it("keeps one draft per order and logs the send by channel", () => {
    const s = seed();
    suggest(s, C, "o1", "a");
    suggest(s, C, "o1", "b");
    expect(s.drafts).toEqual([{ order: "o1", text: "a" }]);
    expect(sendReply(s, C, "o1")).toBe("Sent");
    expect(last(s).text).toBe("Emailed the acknowledgement in-thread");
    expect(s.drafts).toEqual([]);
    suggest(s, C, "o3", "c");
    expect(sendReply(s, C, "o3")).toBe("Copied, marked sent");
    expect(last(s)).toMatchObject({ kind: "replied", text: "Copied the acknowledgement for WhatsApp and marked it sent" });
    suggest(s, C, "o3", "d");
    dropDraft(s, C, "o3");
    expect(s.drafts).toEqual([]);
  });
});

describe("viewPrices", () => {
  it("logs one price view per person per order", () => {
    const s = seed();
    viewPrices(s, C, "o1");
    viewPrices(s, C, "o1");
    viewPrices(s, { me: "May", at: C.at }, "o1");
    expect(s.events.filter((e) => e.kind === "price_viewed").map((e) => e.actor)).toEqual(["Eunice", "May"]);
    expect(s.history[0].text).toBe("Viewed prices on Harbour Hotel · HH-2231");
  });
});
