import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { DemoState, Person, Role } from "@/sample";
import { visibleOrders } from "@/platform/access";
import { ask, suggestions, summarisePrompt, type Answer } from "./ask";
import { MONEY } from "./tools";

const by = (s: DemoState, role: Role): Person => s.people.find((p) => p.role === role)!;
const fixed = { clock: () => 0, at: "10:00", key: "a1" };
/** Everything the assistant writes in an answer (not the question the person typed). */
const said = (a: Answer) => JSON.stringify({ steps: a.steps, records: a.records, prose: a.prose, checked: a.checked });

/** A state with price-bearing events on top of the seed, so the price rule has something to hide. */
function withMoney(): DemoState {
  const s = seed();
  s.events.push(
    { order: "o1", at: "2026-10-01 12:00", kind: "invoiced", actor: "Farah", text: "Invoiced INV-2610-001 · $184.00" },
    { order: "o1", at: "2026-10-01 12:05", kind: "price_viewed", actor: "May", text: "Viewed prices" },
    { order: "o2", at: "2026-10-01 12:10", kind: "comment", actor: "May", text: "Credit S$ 40 next invoice" },
  );
  return s;
}

const QUESTIONS = [
  "What needs me today?",
  "What is still open for Marina Grand?",
  "What goes out tomorrow?",
  "Catch me up on Harbour Hotel",
  "What changed on HH-2231?",
  "What happened on 4810286013 since yesterday?",
  "What goes out Monday?",
  "Anything blocked?",
  "Summarise HH-2231, 4810286013",
  "What is outstanding for Pavilion Kitchen?",
  "History of RC-0917",
  "How much is the Harbour Hotel order worth?",
  "What are the prices on HH-2231?",
  "Catch me up on Orchard Deli",
  "What is pending?",
  "hello",
];

describe("ask: the prototype's three lookups", () => {
  const s = seed();
  const eunice = by(s, "coordinator");

  it("what needs me today: searches, opens both, two short sentences of facts", () => {
    const a = ask(s, eunice, "What needs me today?", fixed);
    expect(a.steps.map((x) => x.tool)).toEqual(["find_orders", "open_order", "open_order"]);
    expect(a.steps[0]).toMatchObject({ label: "Searched orders needing a check", params: "state: needs", rows: "2 orders", ms: "0.0" });
    expect(a.steps[1]).toMatchObject({ label: "Opened 4810286013", params: "order: 4810286013", rows: "4 lines" });
    expect(a.records.map((r) => r.id)).toEqual(["o2", "o4"]);
    expect(a.records[0]).toEqual({ id: "o2", text: "4810286013 · Marina Grand · 4 lines", meta: "Needs check · Tomorrow" });
    expect(a.prose).toBe("2 orders, 6 lines. One has a revision waiting. One is blocked on a SKU.");
    expect(a.checked).toBe("checked 2 orders, 6 lines");
    expect(a.total).toBe("0.3");
  });

  it("still open for a customer", () => {
    const a = ask(s, eunice, "What is still open for Marina Grand?", fixed);
    expect(a.steps[0]).toMatchObject({ label: "Searched orders for marina grand", params: "customer: marina grand, state: open", rows: "1 orders" });
    expect(a.prose).toBe("1 order, 4 lines. One has a revision waiting.");
  });

  it("what goes out tomorrow", () => {
    const a = ask(s, eunice, "What goes out tomorrow?", fixed);
    expect(a.steps[0]).toMatchObject({ label: "Searched orders on tomorrow", params: "date: 2026-10-02" });
    expect(a.records.map((r) => r.id)).toEqual(["o1", "o2"]);
  });

  it("catch me up on a customer reads the latest order's history", () => {
    const a = ask(s, eunice, "Catch me up on Harbour Hotel", fixed);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({ label: "Read the history of HH-2231", tool: "order_history", rows: "4 events" });
    expect(a.records).toHaveLength(4);
    expect(a.records[3]).toEqual({ id: "o1", text: "Rule · Linked a WhatsApp message from Chef Lim", meta: "Today 11:05" });
    expect(a.prose).toBe("4 events on Harbour Hotel · HH-2231. Last: linked a whatsapp message from chef lim.");
  });

  it("scoped to an order: history questions read that order, others list the customer's open orders", () => {
    const h = ask(s, eunice, "What changed on 4810286013?", { ...fixed, orderId: "o2" });
    expect(h.steps[0].label).toBe("Read the history of 4810286013");
    expect(h.checked).toBe("checked 1 order, 5 events");
    const o = ask(s, eunice, "Anything else?", { ...fixed, orderId: "o2" });
    expect(o.steps[0].params).toBe("customer: marina grand, state: open");
  });

  it("summarise a set of orders by reference", () => {
    const os = s.orders.filter((o) => ["o1", "o2"].includes(o.id));
    const a = ask(s, eunice, summarisePrompt(os), fixed);
    expect(a.q).toBe("Summarise HH-2231, 4810286013");
    expect(a.records.map((r) => r.id)).toEqual(["o1", "o2"]);
    expect(a.steps.filter((x) => x.tool === "open_order")).toHaveLength(2);
  });

  it("is deterministic", () => {
    for (const q of QUESTIONS) expect(ask(s, eunice, q, fixed)).toEqual(ask(s, eunice, q, fixed));
  });

  it("suggestions follow the scoped order", () => {
    expect(suggestions(null)[0]).toBe("What needs me today?");
    expect(suggestions(s.orders[0])[0]).toBe("What changed on HH-2231?");
  });
});

describe("ask: role rules", () => {
  it("the packing lead never sees a price or amount in any answer", () => {
    const s = withMoney();
    const mei = by(s, "packing");
    for (const q of QUESTIONS) {
      for (const orderId of [null, "o1", "o2"]) {
        const a = ask(s, mei, q, { ...fixed, orderId });
        expect(said(a), `${q} (scoped to ${orderId})`).not.toMatch(MONEY);
      }
    }
  });

  it("price roles still see amounts in the history, so the rule is the role, not the data", () => {
    const s = withMoney();
    const a = ask(s, by(s, "owner"), "What changed on HH-2231?", fixed);
    expect(said(a)).toMatch(MONEY);
    expect(said(a)).not.toContain("Viewed prices");
  });

  it("an account manager's lookups only cover their own customers", () => {
    const s = withMoney();
    const dennis = by(s, "account_manager");
    const mine = new Set(visibleOrders(s.orders, dennis).map((o) => o.id));
    for (const q of QUESTIONS) {
      for (const orderId of [null, "o2", "o4", "o5"]) {
        const a = ask(s, dennis, q, { ...fixed, orderId });
        for (const r of a.records) expect(mine.has(r.id), `${q} → ${r.id}`).toBe(true);
        // Steps may echo the words of the question; what was found never reaches past their customers.
        expect(JSON.stringify({ records: a.records, prose: a.prose })).not.toMatch(/Riverside|Pavilion|Orchard|RC-0917|OD-2210/);
        expect(said(a)).not.toMatch(MONEY);
      }
    }
    expect(ask(s, dennis, "What needs me today?", fixed).records.map((r) => r.id)).toEqual(["o2"]);
  });

  it("an account manager asking about another customer gets nothing", () => {
    const s = seed();
    const dennis = by(s, "account_manager");
    expect(ask(s, dennis, "Catch me up on Riverside Club", fixed).prose).toBe("Nothing matches.");
    expect(ask(s, dennis, "History of RC-0917", fixed).prose).toBe("Nothing matches.");
    // Scoping to an order they cannot see is ignored.
    expect(ask(s, dennis, "What changed?", { ...fixed, orderId: "o4" }).steps[0].tool).toBe("find_orders");
  });
});
