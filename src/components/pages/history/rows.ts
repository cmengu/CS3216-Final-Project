/*
 * The rows of the History page, as the prototype's historyView(): every order event plus the
 * history entries that belong to no order, newest first. The owner sees all of it; everyone
 * else sees their own entries and the events on orders in their view, and "price viewed"
 * events only when their role sees prices.
 */
import { canPrice, isOwner, seesCustomer } from "@/platform/access";
import type { DemoState, Person } from "@/sample";

export interface HistoryRow {
  at: string;
  who: string;
  kind: string;
  order: string | null;
  text: string;
}

export interface HistoryFilter {
  who: string;
  kind: string;
}

export function historyRows(s: Pick<DemoState, "events" | "history" | "orders">, u: Person): HistoryRow[] {
  const all: HistoryRow[] = [
    ...s.events.map((e) => ({ at: e.at, who: e.actor, kind: e.kind, order: e.order, text: e.text })),
    ...s.history.filter((x) => !x.order),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const mineOnly = !isOwner(u);
  const inView = (id: string | null) => {
    if (!id) return false;
    const o = s.orders.find((x) => x.id === id);
    return !!o && seesCustomer(u, o.cust);
  };
  return all.filter((x) => (!mineOnly || x.who === u.name || inView(x.order)) && (x.kind !== "price_viewed" || canPrice(u)));
}

/** The people and event kinds the filters offer, from the rows this person may see. */
export const filterOptions = (rows: HistoryRow[]) => ({
  kinds: [...new Set(rows.map((r) => r.kind))].sort(),
  whos: [...new Set(rows.map((r) => r.who))].sort(),
});

export const applyFilter = (rows: HistoryRow[], f: HistoryFilter) => rows.filter((r) => (!f.who || r.who === f.who) && (!f.kind || r.kind === f.kind));

/** "revision_proposed" reads as "revision proposed". */
export const kindText = (k: string) => k.replace(/_/g, " ");

/** The event label's colour. */
export const kindClass = (k: string) =>
  /dismiss|unconfirm|revision_proposed|blocked/.test(k) ? "l-warn" : /confirm|approve|deliver/.test(k) ? "l-good" : /price/.test(k) ? "l-info" : "l-mute";
