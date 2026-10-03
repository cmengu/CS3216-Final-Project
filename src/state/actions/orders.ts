/*
 * Order actions, as the prototype's deliver(), invoice(), confirmOrder(), unconfirm(), approve(),
 * fixRev(), dismiss(), fillCell(), addComment(), suggest(), dropDraft() and sendReply().
 * Each op changes a draft of the demo state and writes the same events and history the
 * prototype writes; it returns the toast to show. `run()` applies one through the store.
 */
import { TODAY } from "@/sample";
import type { DemoState, Order } from "@/sample";
import { ref } from "@/lib/format";
import { getState, meOf, update } from "@/state/demo-store";

/** The demo's clock: the fixed TODAY with the real time of day, as the prototype's nowStr(). */
export function nowStr(d: Date = new Date()): string {
  return TODAY + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/** Who acts and when. */
export interface Ctx {
  me: string;
  at: string;
}

type Op<A extends unknown[]> = (s: DemoState, c: Ctx, ...args: A) => string;

const find = (s: DemoState, id: string): Order => {
  const o = s.orders.find((x) => x.id === id);
  if (!o) throw new Error(`No order ${id}`);
  return o;
};

const title = (s: DemoState, o: Order) => `${s.customers[o.cust].name} · ${ref(o)}`;

/** One entry on the order's timeline and the same in History. */
export function addEvent(s: DemoState, c: Ctx, order: string, kind: string, text: string, actor?: string) {
  const who = actor || c.me;
  s.events.push({ order, at: c.at, kind, actor: who, text });
  s.history.push({ at: c.at, who, kind, order, text });
}

export const deliver: Op<[id: string]> = (s, c, id) => {
  find(s, id).state = "delivered";
  addEvent(s, c, id, "delivered", "Marked delivered");
  return "Marked delivered";
};

export const bulkDeliver: Op<[ids: string[]]> = (s, c, ids) => {
  ids.forEach((id) => {
    find(s, id).state = "delivered";
    addEvent(s, c, id, "delivered", "Marked delivered");
  });
  return `${ids.length} marked delivered`;
};

export const invoice: Op<[id: string]> = (s, c, id) => {
  const n = "INV-2610-" + String((s.seq++ % 900) + 100);
  find(s, id).invoiced = n;
  addEvent(s, c, id, "invoiced", `Invoiced ${n}`);
  return `Invoiced ${n}`;
};

export const confirmOrder: Op<[id: string]> = (s, c, id) => {
  const o = find(s, id);
  if (!s.settings.retainsRows) return "Retention is off";
  if (o.lines.some((l) => !l.sku)) return "A cell still has no SKU";
  o.state = "confirmed";
  o.confirmedBy = c.me;
  addEvent(s, c, id, "confirmed", `Confirmed ${o.lines.length} lines`);
  return "Confirmed";
};

export const unconfirm: Op<[id: string]> = (s, c, id) => {
  const o = find(s, id);
  o.state = "draft";
  o.fromAdd = true;
  s.toCheck = s.toCheck.filter((t) => t.order !== id);
  addEvent(s, c, id, "unconfirmed", o.exported ? "Unconfirmed · already exported, re-send the sheet" : "Unconfirmed · rows back in the grid");
  return "Unconfirmed";
};

const revision = (s: DemoState, tid: string) => {
  const t = s.toCheck.find((x) => x.id === tid);
  if (!t || t.kind !== "revision") throw new Error(`No revision ${tid}`);
  return t;
};

/** Approve change: the new quantities go onto the order and packing sees them. */
export const approve: Op<[tid: string]> = (s, c, tid) => {
  const t = revision(s, tid);
  const o = find(s, t.order);
  t.diff.forEach((d) => {
    o.lines[d.line].qty = +d.new;
  });
  o.state = "confirmed";
  s.toCheck = s.toCheck.filter((x) => x.id !== tid);
  const d = t.diff[0];
  addEvent(s, c, o.id, "revision_approved", `Approved line ${d.line + 1} qty ${d.old} → ${d.new}`);
  return `Approved · packing sees ${d.new}`;
};

/** Keep the old quantity and note it. */
export const keepOld: Op<[tid: string]> = (s, c, tid) => {
  const t = revision(s, tid);
  const o = find(s, t.order);
  o.state = "confirmed";
  s.toCheck = s.toCheck.filter((x) => x.id !== tid);
  addEvent(s, c, o.id, "revision_fixed", `Kept ${t.diff[0].old} · “hotel to confirm by phone”`);
  return "Kept, noted";
};

export const DISMISS_REASONS = ["hotel error", "our error", "duplicate", "other"] as const;

/** Dismiss the revision; a reason is required. */
export const dismiss: Op<[tid: string, reason: string]> = (s, c, tid, reason) => {
  if (!reason) return "Pick a reason first";
  const t = revision(s, tid);
  const o = find(s, t.order);
  o.state = "confirmed";
  s.toCheck = s.toCheck.filter((x) => x.id !== tid);
  addEvent(s, c, o.id, "revision_dismissed", `Dismissed the revision · ${reason}`);
  return `Dismissed · ${reason}`;
};

/** Fill the line with no SKU, propose the alias, and confirm the order. */
export const fillCell: Op<[tid: string, sku: string]> = (s, c, tid, sku) => {
  if (!sku) return "Pick a SKU";
  const t = s.toCheck.find((x) => x.id === tid);
  if (!t) throw new Error(`No item ${tid}`);
  const o = find(s, t.order);
  const i = o.lines.findIndex((l) => !l.sku);
  const l = o.lines[i];
  l.sku = sku;
  l.origin = "manual";
  o.state = "confirmed";
  o.confirmedBy = c.me;
  s.toCheck = s.toCheck.filter((x) => x.id !== tid);
  const al = s.aliases.find((a) => a.text === l.desc);
  if (al) {
    al.sku = sku;
    al.state = "proposed";
  }
  addEvent(s, c, o.id, "confirmed", `Filled line ${i + 1} with ${sku} · alias proposed · confirmed ${o.lines.length} lines`);
  return "Filled · alias proposed";
};

/** "Note for the team": the comment, a "Commented" event, and the text in History. */
export const addComment: Op<[id: string, text: string]> = (s, c, id, text) => {
  const t = text.trim();
  if (!t) return "";
  s.comments.push({ order: id, at: c.at, who: c.me, text: t });
  s.events.push({ order: id, at: c.at, kind: "comment", actor: c.me, text: "Commented" });
  s.history.push({ at: c.at, who: c.me, kind: "comment", order: id, text: t });
  return "Posted";
};

/** Suggest reply: one draft per order. */
export const suggest: Op<[id: string, text: string]> = (s, _c, id, text) => {
  if (s.drafts.some((d) => d.order === id)) return "";
  s.drafts.push({ order: id, text });
  return "";
};

export const dropDraft: Op<[id: string]> = (s, _c, id) => {
  s.drafts = s.drafts.filter((d) => d.order !== id);
  return "";
};

/** Send email, or copy for WhatsApp and mark sent. The copy itself happens in the page. */
export const sendReply: Op<[id: string]> = (s, c, id) => {
  const wa = find(s, id).source === "whatsapp";
  addEvent(s, c, id, "replied", wa ? "Copied the acknowledgement for WhatsApp and marked it sent" : "Emailed the acknowledgement in-thread");
  s.drafts = s.drafts.filter((d) => d.order !== id);
  return wa ? "Copied, marked sent" : "Sent";
};

/** Opening an order with prices logs one "Viewed prices" per person per order. */
export const viewPrices: Op<[id: string]> = (s, c, id) => {
  if (s.events.some((e) => e.order === id && e.kind === "price_viewed" && e.actor === c.me)) return "";
  const o = find(s, id);
  s.events.push({ order: id, at: c.at, kind: "price_viewed", actor: c.me, text: "Viewed prices" });
  s.history.push({ at: c.at, who: c.me, kind: "price_viewed", order: id, text: `Viewed prices on ${title(s, o)}` });
  return "";
};

/** Apply an op through the store as the person working now; returns its toast. */
export function run<A extends unknown[]>(op: Op<A>, ...args: A): string {
  const c: Ctx = { me: meOf(getState()).name, at: nowStr() };
  let out = "";
  update((s) => {
    out = op(s, c, ...args);
  });
  return out;
}
