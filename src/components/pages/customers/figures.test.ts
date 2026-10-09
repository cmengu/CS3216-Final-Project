import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { activity, highlights, listRow, onTimePct, profileFigures, visibleCustomers } from "./figures";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;
const C = (id: string) => S.customers[id];

describe("visibleCustomers", () => {
  it("shows every customer to all-customer roles", () => {
    expect(visibleCustomers(S, by("coordinator")).map((c) => c.id)).toEqual(Object.keys(S.customers));
    expect(Object.keys(S.customers).slice(0, 5)).toEqual(["C10243", "C10310", "C10388", "C10402", "C10419"]);
  });
  it("keeps an account manager to their own customers", () => {
    expect(visibleCustomers(S, by("account_manager")).map((c) => c.id)).toEqual(["C10243", "C10310"]);
  });
});

describe("Customers list rows", () => {
  it("counts open orders, the last order and orders in 30 days", () => {
    const hh = listRow(S, C("C10243"));
    // o1 confirmed is open; o6, o8, o11, o12 delivered. All five fall on or after 1 Sep.
    expect(hh.open).toBe(1);
    expect(hh.last?.id).toBe("o1");
    expect(hh.m30).toBe(5);
    const od = listRow(S, C("C10419"));
    expect(od).toMatchObject({ open: 0, m30: 1 });
  });
});

describe("customer page highlights", () => {
  it("Harbour Hotel: orders, lines, average, on time and billed", () => {
    const h = highlights(S, "C10243");
    expect(h.orders30).toBe(5);
    expect(h.lines30).toBe(6 + 2 + 3 + 3 + 2);
    expect(h.avgLines).toBe("3.2");
    expect(h.onTime).toBe(100);
    // Delivered in the window: o6, o8, o11, o12.
    const want = 4 * 5.4 + 2 * 6.2 + (4 * 5.4 + 2 * 5.8 + 5.2) + (4 * 5.4 + 2 * 6.2 + 7.1) + (3 * 5.4 + 2 * 6.2);
    expect(h.billed30).toBeCloseTo(want);
  });

  it("six weekly bars ending today, the last highlighted, scaled to the busiest week", () => {
    const h = highlights(S, "C10243");
    expect(h.weeks).toHaveLength(6);
    expect(h.weeks[5]).toMatchObject({ end: "2026-10-01", start: "2026-09-25", hi: true });
    expect(h.weeks.filter((w) => w.hi)).toHaveLength(1);
    expect(Math.max(...h.weeks.map((w) => w.height))).toBe(100);
    expect(h.weeks.map((w) => w.n)).toEqual([0, 0, 0, 1, 1, 2]);
  });

  it("shows a dash when nothing was delivered", () => {
    expect(highlights(S, "C10402").onTime).toBeNull();
    expect(highlights(S, "C10402").avgLines).toBe("2.0");
  });
});

describe("on time", () => {
  it("counts a delivery marked after its date as late", () => {
    const os = S.orders.filter((o) => o.cust === "C10243");
    const ev = S.events.map((e) => (e.order === "o6" && e.kind === "delivered" ? { ...e, at: "2026-09-30 09:00" } : e));
    expect(onTimePct(os, ev)).toBe(75);
  });
});

describe("profile figures", () => {
  it("flags needs check before blocked, and counts the 30-day window", () => {
    expect(profileFigures(S, "C10310").flag).toBe("w");
    expect(profileFigures(S, "C10402").flag).toBe("b");
    expect(profileFigures(S, "C10419").flag).toBe("");
  });
  it("finds the last invoice and what is left to invoice", () => {
    const f = profileFigures(S, "C10243");
    expect(f.lastInv?.invoiced).toBe("INV-2609-014");
    expect(f.unInv).toBe(0);
    expect(profileFigures(S, "C10310").unInv).toBe(1);
    expect(profileFigures(S, "C10402").lastInv).toBeNull();
  });
  it("last price per SKU comes from the newest order, at most four", () => {
    const f = profileFigures(S, "C10243");
    expect(f.lastPrice).toHaveLength(4);
    const [sku, [price, order]] = f.lastPrice[0];
    expect(sku).toBe("EGC-PTND");
    expect(price).toBe(5.4);
    expect(order.id).toBe("o1");
  });
  it("no billed line when nothing is in the 30-day window", () => {
    const old = { ...S, orders: S.orders.map((o) => (o.cust === "C10419" ? { ...o, date: "2026-07-01" } : o)) };
    expect(profileFigures(old, "C10419").billed30).toBeNull();
  });
});

describe("activity", () => {
  it("is newest first and capped at 14", () => {
    const ev = activity(S, "C10243", "all");
    expect(ev).toHaveLength(14);
    expect(ev[0].at >= ev[1].at).toBe(true);
    expect(ev[0].text).toBe("Linked a WhatsApp message from Chef Lim");
  });
  it("filters changes, messages and notes", () => {
    expect(activity(S, "C10310", "changes").map((e) => e.kind)).toEqual(["received_again", "revision_proposed"]);
    expect(activity(S, "C10243", "messages").map((e) => e.kind)).toEqual(["message_linked"]);
    expect(activity(S, "C10243", "notes")).toEqual([]);
  });
  it("leaves out price views", () => {
    const s = { ...S, events: [...S.events, { order: "o1", at: "2026-10-01 23:59", kind: "price_viewed", actor: "May", text: "Viewed prices" }] };
    expect(activity(s, "C10243", "all").some((e) => e.kind === "price_viewed")).toBe(false);
  });
});
