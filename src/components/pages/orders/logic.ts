/*
 * Pure helpers for the Orders list and the order page, ported from the prototype's
 * ordersView(), orderText(), summarise(), stepper() and sourceCard(). The acknowledgement is
 * the shared ackText in src/lib/ack-text.ts; the customer pane is the customers area's Profile.
 */
import { seesCustomer, visibleOrders } from "@/platform/access";
import { PRODUCTS } from "@/sample";
import type { Customer, DemoState, Order, OrderEvent, OrderState, Person, ToCheck } from "@/sample";
import { dayLabel, fmtDay, isOverdue, outlets, ref, relDay, STATE, custOf } from "@/lib/format";
import type { IconName } from "@/components/icons";

/* ------------------------------------------------------------------ list ---- */

export type Tab = "all" | "needs_check" | "blocked" | "confirmed" | "delivered" | "draft" | "overdue";
export type Sort = "date" | "customer" | "state";

export const TABIC: Record<Tab, IconName> = {
  all: "list",
  needs_check: "warn",
  blocked: "x",
  confirmed: "check",
  delivered: "truck",
  draft: "doc",
  overdue: "clock",
};

/** The tabs and their counts. Draft and Overdue appear only when they have orders. */
export function tabsFor(mine: Order[]): { tabs: [Tab, string][]; counts: Record<Tab, number> } {
  const by = (st: OrderState) => mine.filter((o) => o.state === st).length;
  const counts: Record<Tab, number> = {
    all: mine.length,
    needs_check: by("needs_check"),
    blocked: by("blocked"),
    confirmed: by("confirmed"),
    delivered: by("delivered"),
    draft: by("draft"),
    overdue: mine.filter(isOverdue).length,
  };
  const tabs: [Tab, string][] = [
    ["all", "All"],
    ["needs_check", "Needs check"],
    ["blocked", "Blocked"],
    ["confirmed", "Confirmed"],
    ["delivered", "Delivered"],
  ];
  if (counts.draft) tabs.splice(1, 0, ["draft", "Draft"]);
  if (counts.overdue) tabs.splice(1, 0, ["overdue", "Overdue"]);
  return { tabs, counts };
}

export interface Group {
  k: string;
  items: Order[];
}

const DATE_ORDER = ["Today", "Tomorrow", "This week", "Later", "Earlier this week", "Earlier"];

/** Filter by tab, customer, and optional search query, then sort and group (by delivery day, customer or status). */
export function groupOrders(mine: Order[], customers: Record<string, Customer>, f: string, fc: string, sort: Sort, q = ""): Group[] {
  const name = (o: Order) => custOf(customers, o.cust).name;
  const ql = q.trim().toLowerCase();
  const list = mine
    .filter((o) => f === "all" || (f === "overdue" ? isOverdue(o) : o.state === f))
    .filter((o) => !fc || o.cust === fc)
    .filter((o) => !ql || searchKey(o, custOf(customers, o.cust)).includes(ql));
  list.sort((a, b) =>
    sort === "customer"
      ? name(a).localeCompare(name(b)) || b.date.localeCompare(a.date)
      : sort === "state"
        ? a.state.localeCompare(b.state) || b.date.localeCompare(a.date)
        : b.date.localeCompare(a.date) || a.cust.localeCompare(b.cust),
  );
  const groups: Group[] = [];
  list.forEach((o) => {
    const k = sort === "customer" ? name(o) : sort === "state" ? STATE[o.state][1] : dayLabel(o.date);
    const g = groups.find((x) => x.k === k);
    if (g) g.items.push(o);
    else groups.push({ k, items: [o] });
  });
  if (sort === "date") groups.sort((a, b) => DATE_ORDER.indexOf(a.k) - DATE_ORDER.indexOf(b.k));
  return groups;
}

/**
 * The row's grey line after the reference. Computes revision and missing-SKU summaries from
 * the order's actual review item and lines, falling back gracefully when no review record exists.
 */
export function whyText(o: Order, toCheck?: ToCheck[]): string {
  if (o.state === "needs_check") {
    const rev = toCheck?.find((t): t is Extract<ToCheck, { kind: "revision" }> => t.order === o.id && t.kind === "revision");
    if (rev && rev.diff[0]) {
      const d = rev.diff[0];
      return `${d.field.toLowerCase()} ${d.old} → ${d.new} on line ${d.line + 1}, unconfirmed`;
    }
    if (!toCheck) return "qty 4 → 6 on line 1, unconfirmed";
    return "needs review, unconfirmed";
  }
  if (o.state === "blocked") {
    const missing = o.lines.filter((l) => !l.sku).length;
    if (missing > 0) return `${missing} ${missing === 1 ? "cell has" : "cells have"} no SKU`;
    return "blocked · review required";
  }
  return `${o.lines.length} lines · ${outlets(o).join(", ")}`;
}

/** What the row search matches against. */
export const searchKey = (o: Order, c: Customer) => (c.name + " " + ref(o) + " " + STATE[o.state][1]).toLowerCase();

/** "Copy lines": one header line, then one tab-separated line per order line. */
export function orderText(o: Order, c: Customer): string {
  return (
    `${c.name} · ${ref(o)} · ${fmtDay(o.date)} ${c.slot}\n` +
    o.lines.map((l) => `${l.sku || "—"}\t${l.sku ? PRODUCTS[l.sku].name : l.desc}\t${l.qty} ${l.unit}\t${l.outlet}`).join("\n")
  );
}

/** Customers in the list's filter: the ones this person looks after. */
export const filterCustomers = (s: DemoState, u: Person) => Object.values(s.customers).filter((c) => seesCustomer(u, c.id));

/** The orders this person sees. */
export const mineOf = (s: DemoState, u: Person) => visibleOrders(s.orders, u);

/* ------------------------------------------------------------------ order ---- */

/** A sentence in pieces; `b` pieces are drawn bold. */
export type Rich = (string | { b: string })[];

export const richText = (r: Rich) => r.map((p) => (typeof p === "string" ? p : p.b)).join("");

/** The one-line summary under the order header, derived from the order's review items, lines, and events. */
export function summarise(o: Order, ev: OrderEvent[], toCheck?: ToCheck[]): Rich {
  const conf = ev.filter((e) => e.kind === "confirmed").pop();
  if (o.state === "needs_check") {
    const rev = toCheck?.find((t): t is Extract<ToCheck, { kind: "revision" }> => t.order === o.id && t.kind === "revision");
    const revEv = [...ev].reverse().find((e) => e.kind === "received_again" || e.kind === "revision_proposed");
    if (rev && rev.diff[0]) {
      const d = rev.diff[0];
      const time = revEv ? revEv.at.slice(11) : rev.from.split("·").pop()?.trim() || "";
      return [{ b: "Revised PO" }, `${time ? ` received ${time}` : ""}. Line ${d.line + 1} ${d.field.toLowerCase()} `, { b: `${d.old} → ${d.new}` }, ", unconfirmed."];
    }
    if (!toCheck) {
      const time = revEv ? revEv.at.slice(11) : "10:48";
      return [{ b: "Revised PO" }, ` received ${time}. Line 1 qty `, { b: "4 → 6" }, ", unconfirmed."];
    }
    return [{ b: "Needs check" }, " · awaiting review before confirmation."];
  }
  if (o.state === "blocked") {
    const missing = o.lines.filter((l) => !l.sku).length;
    if (missing > 1) return [`${missing} cells have `, { b: "no SKU" }, ". Export is blocked until they are filled."];
    return ["One cell has ", { b: "no SKU" }, ". Export is blocked until it is filled."];
  }
  if (o.state === "draft") return ["Read, not yet confirmed."];
  if (isOverdue(o)) return ["Due ", { b: fmtDay(o.date) }, ", not marked delivered."];
  const out: Rich = [];
  if (conf) out.push("Confirmed by ", { b: conf.actor }, ` ${relDay(conf.at.slice(0, 10)).toLowerCase()} ${conf.at.slice(11)}`);
  if (o.exported) out.push(", exported");
  out.push(". ");
  if (o.state === "delivered") {
    if (o.invoiced) out.push("Delivered, invoiced ", { b: o.invoiced }, ".");
    else out.push("Delivered, not yet invoiced.");
  } else out.push("Deliver ", { b: fmtDay(o.date) }, ".");
  return out;
}

export interface Step {
  label: string;
  cls: "" | "done" | "now" | "stop";
  done: boolean;
  small: string;
}

/** Read → Confirmed → Exported → Delivered → Invoiced, with the first open step marked. */
export function stepsOf(o: Order, ev: OrderEvent[]): Step[] {
  const has = (k: string) => ev.some((e) => e.kind === k);
  const at = (k: string) => {
    const e = [...ev].reverse().find((x) => x.kind === k);
    return e ? relDay(e.at.slice(0, 10)) + " " + e.at.slice(11) : "";
  };
  const steps: [string, string, boolean][] = [
    ["Read", "read", true],
    ["Confirmed", "confirmed", ["confirmed", "needs_check", "delivered"].includes(o.state) || has("confirmed")],
    ["Exported", "exported", o.exported],
    ["Delivered", "delivered", o.state === "delivered"],
    ["Invoiced", "invoiced", !!o.invoiced],
  ];
  let seenNow = false;
  return steps.map(([label, k, done]) => {
    let cls: Step["cls"] = done ? "done" : "";
    if (!done && !seenNow) {
      cls = (o.state === "needs_check" || o.state === "blocked") && k === "confirmed" ? "stop" : "now";
      seenNow = true;
    }
    if (o.state === "needs_check" && k === "confirmed") cls = "stop";
    const small = done && at(k) ? at(k) : cls === "stop" ? (o.state === "needs_check" ? "changed" : "blocked") : "";
    return { label, cls, done, small };
  });
}

/** Activity events in time order, grouped by day. Price views only for those who see prices. */
export function activityByDay(ev: OrderEvent[], showPriceViews: boolean): { d: string; items: OrderEvent[] }[] {
  const shown = ev.filter((e) => !(e.kind === "price_viewed" && !showPriceViews)).sort((a, b) => a.at.localeCompare(b.at));
  const byDay: { d: string; items: OrderEvent[] }[] = [];
  shown.forEach((e) => {
    const d = e.at.slice(0, 10);
    const g = byDay.find((x) => x.d === d);
    if (g) g.items.push(e);
    else byDay.push({ d, items: [e] });
  });
  return byDay;
}

/* ----------------------------------------------------------------- source ---- */

/** The Source rows: file, layout, read time and fingerprint (or the WhatsApp equivalents). */
export function sourceRows(o: Order, c: Customer): [string, string][] {
  return o.source === "whatsapp"
    ? [
        ["Channel", "WhatsApp paste"],
        ["From", c.sender],
        ["Read", o.file ? o.file.at : "—"],
      ]
    : [
        ["File", o.file ? o.file.name : "—"],
        ["Layout", o.file?.layout || c.layout || "—"],
        ["Read", o.file ? o.file.at : "—"],
        ["Fingerprint", o.file ? o.file.hash : "—"],
      ];
}
