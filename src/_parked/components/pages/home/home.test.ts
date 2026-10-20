import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { visibleOrders } from "@/platform/access";
import { dueOf, parseDue } from "@/lib/format";
import { dueCards, eventTime, goingOut, nextActions, recentEvents, relLabel, reviewItems, toneOf } from "./home";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;

describe("due cards and Going out", () => {
  it("count and name the seed's orders, and agree with each other", () => {
    const cards = dueCards(S, S.orders);
    expect(cards.map((c) => [c.label, c.count, c.names])).toEqual([
      ["Due today", 1, ["Pavilion Kitchen"]],
      ["Due tomorrow", 2, ["Harbour Hotel", "Marina Grand"]],
      ["Later this week", 1, ["Riverside Club"]],
    ]);
    const out = goingOut(S.orders);
    expect(out.length).toBe(cards.reduce((a, c) => a + c.count, 0));
    expect(out.map((o) => o.id)).toEqual(["o3", "o1", "o2", "o4"]);
  });

  it("leave out delivered orders and orders past next week", () => {
    expect(dueOf({ date: "2026-10-01", state: "delivered" })).toBeNull();
    expect(dueOf({ date: "2026-10-08", state: "confirmed" })).toBeNull();
    expect(dueOf({ date: "2026-10-07", state: "confirmed" })).toBe("week");
    expect(parseDue("week")).toBe("week");
    expect(parseDue("soon")).toBeNull();
  });

  it("only show an account manager their own customers", () => {
    const names = dueCards(S, visibleOrders(S.orders, by("account_manager"))).flatMap((c) => c.names);
    expect(names).toEqual(["Harbour Hotel", "Marina Grand"]);
  });

  it("label the schedule and tone the status from the data", () => {
    expect(goingOut(S.orders).map(relLabel)).toEqual(["Today", "Tomorrow", "Tomorrow", "Later this week"]);
    expect([toneOf("confirmed"), toneOf("needs_check"), toneOf("blocked"), toneOf("draft")]).toEqual(["good", "warn", "warn", "neutral"]);
  });
});

describe("reviewItems", () => {
  it("states each issue once, with the action that fits", () => {
    const items = reviewItems(S, by("owner"), S.orders);
    expect(items.map((r) => [r.order.id, r.issue, r.action])).toEqual([
      ["o2", "Quantity changed from 4 to 6", "Review"],
      ["o4", "Missing SKU on line 2", "Resolve"],
    ]);
  });

  it("shows review items only to people who may review", () => {
    expect(reviewItems(S, by("packing"), S.orders)).toEqual([]);
  });

  it("lists overdue orders first", () => {
    const s = seed();
    s.orders.find((o) => o.id === "o1")!.date = "2026-09-30";
    expect(reviewItems(s, by("packing"), s.orders).map((r) => [r.order.id, r.issue])).toEqual([["o1", "Overdue, was due Wed, 30 Sept"]]);
  });
});

describe("nextActions", () => {
  it("only offers routes the role may open", () => {
    expect(nextActions(by("owner"), 2).map((a) => [a.title, a.href, a.count])).toEqual([
      ["Review orders", "/orders?mode=exceptions", 2],
      ["Upload invoice", "/invoices#upload", undefined],
      ["Check discrepancies", "/invoices?mode=audit", undefined],
    ]);
    expect(nextActions(by("coordinator"), 2).map((a) => a.title)).toEqual(["Review orders"]);
    expect(nextActions(by("packing"), 0)).toEqual([]);
  });
});

describe("recent activity", () => {
  it("is newest first, five at most, with today's times bare", () => {
    const ev = recentEvents(S, by("owner"), S.events);
    expect(ev).toHaveLength(5);
    expect(ev[0].text).toBe("Linked a WhatsApp message from Chef Lim");
    expect(eventTime(ev[0].at)).toBe("11:05");
    expect(eventTime("2026-09-30 16:21")).toBe("Yesterday 16:21");
  });
});
