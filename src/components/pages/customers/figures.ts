/*
 * The customer figures, computed from the demo data exactly as the prototype's customersView(),
 * customerView() and profile() compute them. Pure, so they can be tested and later run on the server.
 */
import { PRODUCTS, TODAY } from "@/sample";
import type { Customer, DemoState, Order, OrderEvent, Person } from "@/sample";
import { seesCustomer } from "@/platform/access";
import { addDays, fmtShort, orderTotal } from "@/lib/format";
import { orderIssues } from "@/lib/issues";

/** The customers this person looks after, in the list's order. */
export const visibleCustomers = (s: Pick<DemoState, "customers">, u: Person): Customer[] =>
  Object.values(s.customers).filter((c) => seesCustomer(u, c.id));

const isOpen = (o: Order) => !["delivered", "draft"].includes(o.state);

/** One row of the Customers list. */
export function listRow(s: Pick<DemoState, "orders">, c: Customer) {
  const mine = s.orders.filter((o) => o.cust === c.id);
  const open = mine.filter(isOpen);
  const last = [...mine].sort((a, b) => b.date.localeCompare(a.date))[0];
  // The list counts every order in the window, drafts included, as the prototype does.
  const m30 = mine.filter((o) => o.date >= addDays(TODAY, -30)).length;
  return { open: open.length, last: last ?? null, m30 };
}

/** The customer's orders, newest delivery date first. */
export const customerOrders = (s: Pick<DemoState, "orders">, id: string): Order[] =>
  s.orders.filter((o) => o.cust === id).sort((a, b) => b.date.localeCompare(a.date));

/** Share of delivered orders marked delivered on or before their date, or null with none delivered. */
export function onTimePct(mine: Order[], events: OrderEvent[]): number | null {
  const deliv = mine.filter((o) => o.state === "delivered");
  if (!deliv.length) return null;
  const ok = deliv.filter((o) => {
    const d = events.find((e) => e.order === o.id && e.kind === "delivered");
    return !d || d.at.slice(0, 10) <= o.date;
  }).length;
  return Math.round((100 * ok) / deliv.length);
}

/** Orders in the last 30 days, drafts left out. */
export const last30 = (mine: Order[]) => mine.filter((o) => o.date >= addDays(TODAY, -30) && o.state !== "draft");

/** Delivered value in the last 30 days, before GST. */
export const billed30 = (mine: Order[]) =>
  last30(mine)
    .filter((o) => o.state === "delivered")
    .reduce((a, o) => a + orderTotal(o), 0);

/** The highlight strip and the weekly bars on the customer page. */
export function highlights(s: Pick<DemoState, "orders" | "events">, id: string) {
  const mine = customerOrders(s, id);
  const m30 = last30(mine);
  const lines30 = m30.reduce((a, o) => a + o.lines.length, 0);
  const weeks = [...Array(6)].map((_, i) => {
    const end = addDays(TODAY, -7 * (5 - i));
    const start = addDays(end, -6);
    const n = mine.filter((o) => o.date >= start && o.date <= end && o.state !== "draft").length;
    return { start, end, n };
  });
  const max = Math.max(1, ...weeks.map((w) => w.n));
  return {
    orders30: m30.length,
    lines30,
    avgLines: m30.length ? (lines30 / m30.length).toFixed(1) : "–",
    onTime: onTimePct(mine, s.events),
    billed30: billed30(mine),
    weeks: weeks.map((w, i) => ({
      ...w,
      hi: i === 5,
      height: Math.round((100 * w.n) / max),
      title: `${w.n} orders · ${fmtShort(w.start)}–${fmtShort(w.end)}`,
      label: `${fmtShort(w.start).split(" ")[0]} ${fmtShort(w.start).split(" ")[1]}`,
    })),
  };
}

/** The figures in the customer profile (the right-hand dossier, also the order page's side pane). */
export function profileFigures(s: Pick<DemoState, "orders" | "events">, id: string) {
  const mine = customerOrders(s, id);
  const open = mine.filter(isOpen);
  const m30 = last30(mine);
  const deliv = mine.filter((o) => o.state === "delivered");
  const lastInv = [...mine].filter((o) => o.invoiced).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const unInv = deliv.filter((o) => !o.invoiced);
  const lastPrice: Record<string, [price: number, order: Order]> = {};
  [...mine]
    .filter((x) => x.state !== "draft")
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((x) =>
      x.lines.forEach((l) => {
        if (l.sku) lastPrice[l.sku] = [PRODUCTS[l.sku].price, x];
      }),
    );
  const flag = open.some((o) => o.state === "needs_check") ? "w" : open.some((o) => o.state === "blocked") ? "b" : "";
  return {
    mine,
    open: open.length,
    m30: m30.length,
    onTime: onTimePct(mine, s.events),
    lastInv,
    unInv: unInv.length,
    billed30: m30.length ? billed30(mine) : null,
    lastPrice: Object.entries(lastPrice).slice(0, 4),
    flag,
  };
}

export type ActivityFilter = "all" | "changes" | "messages" | "notes";
export const ACTIVITY_FILTERS: [ActivityFilter, string][] = [
  ["all", "All"],
  ["changes", "Changes"],
  ["messages", "Messages"],
  ["notes", "Notes"],
];

/** The customer's activity, newest first, at most 14 events. */
export function activity(s: Pick<DemoState, "orders" | "events">, id: string, flt: ActivityFilter): OrderEvent[] {
  const ids = new Set(customerOrders(s, id).map((o) => o.id));
  return s.events
    .filter((e) => ids.has(e.order) && e.kind !== "price_viewed")
    .filter((e) =>
      flt === "all"
        ? true
        : flt === "messages"
          ? e.kind === "message_linked"
          : flt === "changes"
            ? /revision|received_again|blocked|unconfirm/.test(e.kind)
            : e.kind === "comment",
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);
}

/* ------------------------------------------------------- redesigned directory and page ---- */

/** One row of the Customers directory: open orders, the next delivery, the contact, and any issue. */
export interface DirectoryRow {
  c: Customer;
  open: number;
  next: Order | null;
  contact: string;
  issue: string | null;
}

/** Open orders: everything not yet delivered (drafts included, so no order falls between Open and Past). */
export const openOrders = (mine: Order[]) => mine.filter((o) => o.state !== "delivered");
/** Past orders: delivered ones, newest first. */
export const pastOrders = (mine: Order[]) => mine.filter((o) => o.state === "delivered");

export function directoryRows(s: Pick<DemoState, "customers" | "orders" | "toCheck">, u: Person): DirectoryRow[] {
  return visibleCustomers(s, u).map((c) => {
    const open = openOrders(customerOrders(s, c.id));
    const next = [...open].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const issues = open.flatMap((o) => orderIssues(o, s.toCheck));
    const issue = issues.length ? issues[0].text + (issues.length > 1 ? ` (+${issues.length - 1} more)` : "") : null;
    return { c, open: open.length, next, contact: c.sender, issue };
  });
}

export type DirectorySort = "name" | "open" | "next";

/** Sort the directory; customers with no open order always go last when sorting by next delivery. */
export function sortRows(rows: DirectoryRow[], by: DirectorySort, desc: boolean): DirectoryRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (by === "next" && !a.next !== !b.next) return a.next ? -1 : 1;
    const n =
      by === "name" ? a.c.name.localeCompare(b.c.name) : by === "open" ? a.open - b.open : (a.next?.date ?? "").localeCompare(b.next?.date ?? "");
    return dir * n || a.c.name.localeCompare(b.c.name);
  });
}

/** Search by name, customer ID, type or contact. */
export const matches = (r: DirectoryRow, q: string) => {
  const ql = q.trim().toLowerCase();
  return !ql || [r.c.name, r.c.id, r.c.kind, r.contact].join(" ").toLowerCase().includes(ql);
};

/** The weekly bars as one sentence, for people who cannot see the chart. */
export const weeksText = (weeks: { n: number; label: string }[]) =>
  "Orders per week: " + weeks.map((w) => `week of ${w.label}, ${w.n}`).join("; ") + ".";
