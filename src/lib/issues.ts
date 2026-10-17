/*
 * What is wrong with an open order, in plain words, and the action that fixes it. Home, the
 * Customers list and the customer page all read issues from here so they say the same thing.
 */
import type { Order, ToCheck } from "@/sample";
import { fmtDay, isOverdue } from "./format";

export interface Issue {
  text: string;
  action: "Review" | "Resolve";
}

const FIELD: Record<string, string> = { Qty: "Quantity" };

/** "Quantity changed from 4 to 6", plus how many more changes the revision carries. */
export function revisionText(t: Extract<ToCheck, { kind: "revision" }>): string | null {
  const d = t.diff[0];
  if (!d) return null;
  const more = t.diff.length > 1 ? `, and ${t.diff.length - 1} more change${t.diff.length > 2 ? "s" : ""}` : "";
  return `${FIELD[d.field] ?? d.field} changed from ${d.old} to ${d.new}${more}`;
}

/** "Missing SKU on line 2", or "Missing SKU" when the review item names no line. */
export function cellText(t: Extract<ToCheck, { kind: "cell" }>): string {
  const line = /^Line (\d+)/.exec(t.text)?.[1];
  return line ? `Missing SKU on line ${line}` : "Missing SKU";
}

export const overdueText = (o: Order) => `Overdue, was due ${fmtDay(o.date)}`;

/** Every issue on one order: overdue, then its review items, then its state when no review item explains it. */
export function orderIssues(o: Order, toCheck: ToCheck[]): Issue[] {
  const out: Issue[] = [];
  if (isOverdue(o)) out.push({ text: overdueText(o), action: "Review" });
  const items = toCheck.filter((t) => t.order === o.id);
  for (const t of items) {
    if (t.kind === "revision") {
      const text = revisionText(t);
      if (text) out.push({ text, action: "Review" });
    } else out.push({ text: cellText(t), action: "Resolve" });
  }
  if (!items.length && o.state === "needs_check") out.push({ text: "Needs check", action: "Review" });
  if (!items.length && o.state === "blocked") out.push({ text: "Missing SKU", action: "Resolve" });
  return out;
}
