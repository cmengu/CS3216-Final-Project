import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { DemoState, Role } from "@/sample";
import { applyFilter, filterOptions, historyRows, kindClass } from "./rows";

const by = (s: DemoState, role: Role) => s.people.find((p) => p.role === role)!;

/* The seed plus a price view, an owner's entry with no order and the packing lead's own entry. */
function state(): DemoState {
  const s = seed();
  s.events.push({ order: "o1", at: "2026-10-01 12:00", kind: "price_viewed", actor: "Eunice", text: "Viewed prices" });
  s.events.push({ order: "o1", at: "2026-10-01 12:00", kind: "comment", actor: "Eunice", text: "Commented" });
  s.history.push({ at: "2026-10-01 12:00", who: "Eunice", kind: "comment", order: "o1", text: "the event's copy" });
  s.history.push({ at: "2026-10-01 12:05", who: "May", kind: "role_changed", order: null, text: "Added Ana as Packing lead" });
  s.history.push({ at: "2026-10-01 12:06", who: "Mei", kind: "note_added", order: null, text: "Standing note on Harbour Hotel" });
  return s;
}

describe("historyRows", () => {
  it("gives the owner every event plus entries with no order, newest first", () => {
    const s = state();
    const rows = historyRows(s, by(s, "owner"));
    expect(rows).toHaveLength(s.events.length + 2);
    expect(rows[0].text).toBe("Standing note on Harbour Hotel");
    expect(rows.some((r) => r.kind === "price_viewed")).toBe(true);
    expect(rows.some((r) => r.text === "the event's copy")).toBe(false);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].at >= rows[i].at).toBe(true);
  });

  it("hides price views and other people's entries with no order from the packing lead", () => {
    const s = state();
    const rows = historyRows(s, by(s, "packing"));
    expect(rows.some((r) => r.kind === "price_viewed")).toBe(false);
    expect(rows.some((r) => r.text === "Added Ana as Packing lead")).toBe(false);
    expect(rows.some((r) => r.text === "Standing note on Harbour Hotel")).toBe(true);
    // every event except the price view, plus Mei's own note
    expect(rows).toHaveLength(s.events.length - 1 + 1);
  });

  it("keeps price views for finance", () => {
    const s = state();
    expect(historyRows(s, by(s, "finance")).filter((r) => r.kind === "price_viewed")).toHaveLength(1);
  });

  it("limits an account manager to their own customers' orders", () => {
    const s = state();
    const rows = historyRows(s, by(s, "account_manager"));
    const custOf = (id: string | null) => s.orders.find((o) => o.id === id)?.cust;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !!r.order && ["C10243", "C10310"].includes(custOf(r.order)!))).toBe(true);
    expect(rows.some((r) => r.order === "o3")).toBe(false);
  });
});

describe("filters", () => {
  it("offers the people and kinds in view, sorted, and filters by both", () => {
    const s = state();
    const rows = historyRows(s, by(s, "packing"));
    const { whos, kinds } = filterOptions(rows);
    expect(whos).toEqual([...whos].sort());
    expect(whos).toContain("Mei");
    expect(kinds).not.toContain("price_viewed");
    const mei = applyFilter(rows, { who: "Mei", kind: "" });
    expect(mei.length).toBeGreaterThan(0);
    expect(mei.every((r) => r.who === "Mei")).toBe(true);
    const delivered = applyFilter(rows, { who: "Mei", kind: "delivered" });
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((r) => r.who === "Mei" && r.kind === "delivered")).toBe(true);
    expect(applyFilter(rows, { who: "", kind: "" })).toEqual(rows);
  });

  it("colours the event labels as the prototype", () => {
    expect(kindClass("revision_proposed")).toBe("l-warn");
    expect(kindClass("blocked")).toBe("l-warn");
    expect(kindClass("unconfirmed")).toBe("l-warn");
    expect(kindClass("confirmed")).toBe("l-good");
    expect(kindClass("delivered")).toBe("l-good");
    expect(kindClass("price_viewed")).toBe("l-info");
    expect(kindClass("read")).toBe("l-mute");
  });
});
