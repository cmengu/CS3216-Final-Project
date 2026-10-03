/*
 * The role test, the part that runs without a browser: every seeded person through every helper
 * that decides what reaches the screen or the clipboard. scripts/e2e-roles.mjs walks the same
 * rules through the running app.
 */
import { describe, expect, it } from "vitest";
import { digestLines } from "@/components/pages/HomeView";
import { historyRows } from "@/components/pages/history/rows";
import { invoiceCsv } from "@/components/pages/invoices/invoices";
import { visibleCustomers } from "@/components/pages/customers/figures";
import { mineOf, orderText } from "@/components/pages/orders/logic";
import { ackTextFor } from "@/lib/ack-text";
import { copyTable, exportColumns } from "@/lib/add-orders";
import { COLS } from "@/lib/columns";
import { toRows } from "@/lib/importer";
import { ask, paletteHits, suggestions, summarisePrompt } from "@/platform/assistant";
import { seed } from "@/sample";
import type { DemoState, Person } from "@/sample";
import { buildLists } from "@/sample/lists";
import { harbourPo } from "@/test/po";
import { canInvoice, canPrice, lines, navAllowed, needsPin, pinOk, visibleOrders, type NavKey } from "./access";

/** A money amount in text: a $ anywhere, or a figure with cents. */
const MONEYISH = /\$|\b\d+\.\d{2}\b/;
const ROUTES: NavKey[] = ["home", "orders", "add", "customers", "invoices", "people", "history", "settings"];
const QUESTIONS = [
  ...suggestions(null),
  "What is the total for Marina Grand?",
  "How much do we bill Harbour Hotel?",
  "What did Riverside Club order?",
  "Catch me up on Orchard Deli",
  "What changed on 4810286013?",
  "Show the prices on HH-2231",
];

const S = seed();
const people = S.people.map((p) => [p.name, p.role, p] as const);
const forPerson = (p: Person): DemoState => ({ ...seed(), user: p.id });

describe.each(people)("%s (%s)", (_name, role, p) => {
  const s = forPerson(p);
  const priced = canPrice(p);
  const own = (cust: string) => p.customers === "all" || p.customers.includes(cust);
  const mine = visibleOrders(s.orders, p);

  it("opens only the routes the role table allows", () => {
    const allowed = ROUTES.filter((k) => navAllowed(k, p));
    const expected: Record<string, NavKey[]> = {
      owner: ROUTES,
      coordinator: ["home", "orders", "add", "customers", "history"],
      account_manager: ["home", "orders", "customers", "history"],
      packing: ["home", "orders", "customers", "history"],
      finance: ["home", "orders", "customers", "invoices", "history"],
    };
    expect(allowed).toEqual(expected[role]);
    expect(navAllowed("people", p) || navAllowed("settings", p)).toBe(role === "owner");
    expect(navAllowed("invoices", p)).toBe(role === "owner" || role === "finance");
  });

  it("sees only its own customers' orders and customers", () => {
    expect(mine.every((o) => own(o.cust))).toBe(true);
    expect(mineOf(s, p).map((o) => o.id)).toEqual(mine.map((o) => o.id));
    expect(visibleCustomers(s, p).every((c) => own(c.id))).toBe(true);
    if (role === "account_manager") {
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.length).toBeLessThan(s.orders.length);
    } else expect(mine.length).toBe(s.orders.length);
  });

  it("gets order lines with prices only when the role sees prices", () => {
    for (const o of mine)
      for (const l of lines(o, p)) {
        expect("unitPrice" in l).toBe(priced);
        expect("total" in l).toBe(priced);
      }
  });

  it("copies order lines, acknowledgements and the Home digest without money when the role has no prices", () => {
    const texts = [...mine.map((o) => orderText(o, s.customers[o.cust])), ...mine.map((o) => ackTextFor(s, o)), ...digestLines(s, p, mine)];
    for (const t of texts) if (!priced) expect(t).not.toMatch(MONEYISH);
  });

  it("copies the Add orders table without the price columns when the role has no prices", () => {
    const rows = toRows([harbourPo()], buildLists());
    const names = COLS.map((c) => c[0]);
    const cols = exportColumns(names, priced);
    expect(cols.includes("price") || cols.includes("total")).toBe(priced);
    const head = copyTable(rows, names, priced).split("\n")[0].split("\t");
    expect(head.includes("Price") || head.includes("Total")).toBe(priced);
  });

  it("copies the invoice CSV with totals only for price roles", () => {
    for (const tab of ["open", "done"] as const) {
      const csv = invoiceCsv(s, p, tab).split("\n").slice(1);
      for (const row of csv) {
        const total = row.split(",")[5];
        expect(total !== "").toBe(priced);
      }
      if (!priced) expect(csv.join("\n")).not.toMatch(MONEYISH);
    }
    expect(canInvoice(p)).toBe(role === "owner" || role === "finance");
  });

  it("answers in the assistant without money, and only about its own customers", () => {
    const qs = [...QUESTIONS, ...mine.slice(0, 3).map((o) => summarisePrompt([o]))];
    for (const q of qs) {
      for (const orderId of [null, ...mine.slice(0, 2).map((o) => o.id)]) {
        const a = ask(s, p, q, { orderId, key: "k", at: "10:00" });
        if (!priced) expect(JSON.stringify(a)).not.toMatch(/\$/);
        for (const r of a.records) expect(own(s.orders.find((o) => o.id === r.id)!.cust)).toBe(true);
      }
    }
  });

  it("finds in ⌘K only what it may open", () => {
    for (const q of ["", "a", "Harbour", "Marina", "Riverside", "Orchard", "Pavilion", "invoices", "people", "settings", "$"]) {
      const hits = paletteHits(s, p, q);
      if (!priced) expect(JSON.stringify(hits)).not.toMatch(/\$\s?\d/);
      for (const h of hits) {
        if (h.kind === "order") expect(own(s.orders.find((o) => o.id === h.id)!.cust)).toBe(true);
        if (h.kind === "customer") expect(own(h.id)).toBe(true);
        if (h.kind === "page") expect(navAllowed(h.nav.key, p)).toBe(true);
      }
    }
  });

  it("sees History without price views or other customers when it is not the owner", () => {
    const rows = historyRows(s, p);
    if (!priced) expect(rows.some((r) => r.kind === "price_viewed")).toBe(false);
    if (!priced) expect(rows.map((r) => r.text).join("\n")).not.toMatch(/\$/);
    for (const r of rows) if (r.order && role === "account_manager") expect(own(s.orders.find((o) => o.id === r.order)!.cust) || r.who === p.name).toBe(true);
  });
});

describe("the PIN", () => {
  it("is asked of Owner and Finance only", () => {
    expect(S.people.filter(needsPin).map((p) => p.role)).toEqual(["owner", "finance"]);
  });

  it("is any four digits; anything else is refused", () => {
    for (const ok of ["1234", "0000", "9876"]) expect(pinOk(ok)).toBe(true);
    for (const bad of ["", "123", "12345", "12a4", "abcd", " 1234", "12 34", "１２３４"]) expect(pinOk(bad)).toBe(false);
  });
});
