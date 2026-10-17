/*
 * Pure helpers for Home: what is due, what waits on a person, what goes out, and recent activity.
 * Every count, name and date on Home comes from here, so it reads straight from the demo state.
 */
import { canEdit, canInvoice, seesCustomer } from "@/platform/access";
import { TODAY } from "@/sample";
import type { DemoState, Order, OrderEvent, OrderState, Person } from "@/sample";
import { custOf, DUE, dueOf, fmtDay, isOverdue, relDay, type Due } from "@/lib/format";
import { cellText, overdueText, revisionText } from "@/lib/issues";

export interface DueCard {
  key: Due;
  label: string;
  count: number;
  names: string[];
}

/** The three due-date cards. Names are each customer once, in delivery order. */
export function dueCards(s: DemoState, mine: Order[]): DueCard[] {
  return (Object.keys(DUE) as Due[]).map((key) => {
    const os = mine.filter((o) => dueOf(o) === key).sort((a, b) => a.date.localeCompare(b.date) || a.cust.localeCompare(b.cust));
    return { key, label: DUE[key], count: os.length, names: [...new Set(os.map((o) => custOf(s.customers, o.cust).name))] };
  });
}

export interface ReviewItem {
  key: string;
  order: Order;
  issue: string;
  action: "Review" | "Resolve";
}

/**
 * Orders waiting on a person: overdue orders, then the review items (changed POs, cells with no SKU).
 * Review items only reach people who may review changes.
 */
export function reviewItems(s: DemoState, u: Person, mine: Order[]): ReviewItem[] {
  const out: ReviewItem[] = mine.filter(isOverdue).map((o) => ({ key: "od" + o.id, order: o, issue: overdueText(o), action: "Review" }));
  if (!canEdit(u)) return out;
  for (const t of s.toCheck) {
    const o = mine.find((x) => x.id === t.order);
    if (!o) continue;
    if (t.kind === "revision") {
      const issue = revisionText(t);
      if (issue) out.push({ key: t.id, order: o, issue, action: "Review" });
    } else out.push({ key: t.id, order: o, issue: cellText(t), action: "Resolve" });
  }
  return out;
}

/** Orders going out this week (today through the next six days), soonest first. */
export const goingOut = (mine: Order[]): Order[] =>
  mine.filter((o) => dueOf(o) !== null).sort((a, b) => a.date.localeCompare(b.date) || a.cust.localeCompare(b.cust));

export type Tone = "good" | "warn" | "neutral";

/** Green for confirmed, amber for the states that need someone, neutral for the rest. */
export const toneOf = (st: OrderState): Tone => (st === "confirmed" ? "good" : st === "needs_check" || st === "blocked" ? "warn" : "neutral");

/** The schedule's relative day, in the due cards' words. */
export const relLabel = (o: Order): string => {
  const d = dueOf(o);
  return d === "today" ? "Today" : d === "tomorrow" ? "Tomorrow" : d === "week" ? "Later this week" : fmtDay(o.date);
};

/** The newest events in this person's view (no price views), at most `n`. */
export function recentEvents(s: DemoState, u: Person, events: OrderEvent[], n = 5): OrderEvent[] {
  return events
    .filter((e) => {
      const o = s.orders.find((x) => x.id === e.order);
      return e.kind !== "price_viewed" && !!o && seesCustomer(u, o.cust);
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n);
}

/** "11:05" for today, else "Yesterday 16:21" or "30 Sep 16:21". */
export const eventTime = (at: string) => (at.slice(0, 10) === TODAY ? at.slice(11) : `${relDay(at.slice(0, 10))} ${at.slice(11)}`);

export interface NextAction {
  key: "review" | "upload" | "discrepancies";
  title: string;
  href: string;
  count?: number;
}

/** The next actions this person may take; each goes to a route their role may open. */
export function nextActions(u: Person, reviewCount: number): NextAction[] {
  const out: NextAction[] = [];
  if (canEdit(u)) out.push({ key: "review", title: "Review orders", href: "/orders?mode=exceptions", count: reviewCount });
  if (canInvoice(u)) {
    out.push({ key: "upload", title: "Upload invoice", href: "/invoices#upload" });
    out.push({ key: "discrepancies", title: "Check discrepancies", href: "/invoices?mode=audit" });
  }
  return out;
}
