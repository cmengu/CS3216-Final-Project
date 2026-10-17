import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { orderIssues } from "@/lib/issues";
import { customerOrders, directoryRows, matches, openOrders, pastOrders, sortRows, weeksText, highlights } from "./figures";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;

describe("directory rows", () => {
  const rows = directoryRows(S, by("owner"));
  const row = (id: string) => rows.find((r) => r.c.id === id)!;

  it("count open orders, find the next delivery and the contact from the data", () => {
    expect(rows.map((r) => [r.c.name, r.open, r.next?.date ?? null, r.contact])).toEqual([
      ["Harbour Hotel", 1, "2026-10-02", "Chef Lim"],
      ["Marina Grand", 1, "2026-10-02", "Ms Tan, Purchasing"],
      ["Pavilion Kitchen", 1, "2026-10-01", "Chef Ravi"],
      ["Riverside Club", 1, "2026-10-05", "Procurement portal"],
      ["Orchard Deli", 0, null, "Owner"],
    ]);
  });

  it("names the real issue only for customers that need attention", () => {
    expect(row("C10310").issue).toBe("Quantity changed from 4 to 6");
    expect(row("C10402").issue).toBe("Missing SKU on line 2");
    expect(rows.filter((r) => r.issue).map((r) => r.c.id)).toEqual(["C10310", "C10402"]);
  });

  it("keeps an account manager to their own customers", () => {
    expect(directoryRows(S, by("account_manager")).map((r) => r.c.id)).toEqual(["C10243", "C10310"]);
  });

  it("sorts by name, open orders and next delivery, and searches name, ID, type and contact", () => {
    expect(sortRows(rows, "next", false).map((r) => r.c.id)).toEqual(["C10388", "C10243", "C10310", "C10402", "C10419"]);
    expect(sortRows(rows, "next", true).map((r) => r.c.id)).toEqual(["C10402", "C10243", "C10310", "C10388", "C10419"]);
    expect(sortRows(rows, "name", true)[0].c.name).toBe("Riverside Club");
    expect(sortRows(rows, "open", false)[0].c.id).toBe("C10419");
    expect(rows.filter((r) => matches(r, "hotel")).map((r) => r.c.id)).toEqual(["C10243", "C10310"]);
    expect(rows.filter((r) => matches(r, "c10402")).map((r) => r.c.id)).toEqual(["C10402"]);
    expect(rows.filter((r) => matches(r, "ravi")).map((r) => r.c.id)).toEqual(["C10388"]);
  });
});

describe("customer page orders", () => {
  it("splits every order into Open or Past, never both", () => {
    const mine = customerOrders(S, "C10243");
    const open = openOrders(mine);
    const past = pastOrders(mine);
    expect(open.map((o) => o.id)).toEqual(["o1"]);
    expect(past.map((o) => o.id)).toEqual(["o6", "o8", "o11", "o12"]);
    expect(open.length + past.length).toBe(mine.length);
  });

  it("describes the chart in words", () => {
    const text = weeksText(highlights(S, "C10243").weeks);
    expect(text.startsWith("Orders per week: week of")).toBe(true);
    expect(text.endsWith(".")).toBe(true);
  });
});

describe("orderIssues", () => {
  it("states each open order's issue and its action", () => {
    const o = (id: string) => S.orders.find((x) => x.id === id)!;
    expect(orderIssues(o("o2"), S.toCheck)).toEqual([{ text: "Quantity changed from 4 to 6", action: "Review" }]);
    expect(orderIssues(o("o4"), S.toCheck)).toEqual([{ text: "Missing SKU on line 2", action: "Resolve" }]);
    expect(orderIssues(o("o1"), S.toCheck)).toEqual([]);
    expect(orderIssues(o("o4"), [])).toEqual([{ text: "Missing SKU", action: "Resolve" }]);
  });
});
