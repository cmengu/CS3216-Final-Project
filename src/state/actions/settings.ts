/*
 * The Settings changes, as the prototype makes them. Each takes a draft of the demo state, so pages
 * call them through the store: update((d) => connectMail(d, "Outlook")). Nothing here talks to a
 * real mailbox, WhatsApp or key service; it is all walk-through demo state.
 */
import { TODAY } from "@/sample";
import { MAIL0 } from "@/sample/mail";
import type { DemoState, ReplyOptions } from "@/sample";
import { replyOpt } from "@/lib/ack-text";
import { ROLES } from "@/sample/people";

type D = DemoState;

/** "YYYY-MM-DD HH:MM" on the demo's fixed today (prototype: nowStr). */
export function nowStr(d = new Date()): string {
  return TODAY + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

const myName = (s: D) => (s.people.find((p) => p.id === s.user) ?? s.people[0]).name;

/* ---- connections ---- */

/** Orders mailbox flow step: null (closed), "pick", or the provider being signed in to ("Outlook" / "Gmail"). */
export function mailFlow(s: D, v: string | null) {
  s.cx.mailFlow = v;
}

export function connectMail(s: D, kind: string, at = nowStr().slice(11)) {
  s.cx.mail = { kind, at };
  s.cx.mailFlow = null;
  s.mailbox = MAIL0.map((m) => ({ ...m }));
}

export function disconnectMail(s: D) {
  s.cx.mail = null;
  s.mailbox = null;
}

/** "Check now": the mailbox was looked at just now. */
export function checkMail(s: D, at = nowStr().slice(11)) {
  if (s.cx.mail) s.cx.mail.at = at;
}

export function togglePaste(s: D) {
  s.cx.paste = !s.cx.paste;
}

/** WhatsApp live flow step: null (off), "ask", "no", "qr", "pending". */
export function setWa(s: D, v: string | null) {
  s.cx.wa = v;
}

/** Whether the sample chat export was already imported. */
export const exportImported = (s: D) => s.messages.some((m) => m.id === "m3");

/** "Try a sample export": three messages attach to their orders and one change waits for review. */
export function dropExport(s: D) {
  if (exportImported(s)) return;
  const add = [
    { id: "m3", order: "o1", at: "2026-10-01 11:05", from: "Chef Lim", source: "WhatsApp", text: "Pls send invoice to accounts@ this time thx", linkedBy: "rule" },
    { id: "m4", order: "o2", at: "2026-10-01 10:52", from: "Ms Tan", source: "WhatsApp", text: "4810286013 also add 1 box elderflower for Madame Fan", linkedBy: "rule" },
    { id: "m5", order: "o3", at: "2026-10-01 09:30", from: "Chef Ravi", source: "WhatsApp", text: "thanks received yesterday all good", linkedBy: "rule" },
  ];
  add.forEach((m) => {
    if (!s.messages.some((x) => x.id === m.id)) {
      s.messages.push(m);
      s.events.push({ order: m.order, at: m.at, kind: "message_linked", actor: "Rule", text: `Linked a WhatsApp message from ${m.from}` });
    }
  });
  s.toCheck.push({ id: "t4", kind: "revision", order: "o2", diff: [{ line: 2, field: "Qty", old: "2", new: "3", outlet: "Madame Fan" }], from: "WhatsApp · Ms Tan · 10:52" });
  const o2 = s.orders.find((x) => x.id === "o2");
  if (o2) o2.state = "needs_check";
}

/* ---- products and customers ---- */

/** Rows in an uploaded product list: non-empty lines less the header, at least one (prototype: uploadSku). */
export const skuRows = (text: string) => Math.max(1, text.split(/\r?\n/).filter(Boolean).length - 1);

export function setSkuList(s: D, count: number) {
  s.settings.skuCount = count;
  s.settings.skuDate = "today";
}

/* ---- aliases ---- */

export function aliasOk(s: D, text: string) {
  const a = s.aliases.find((x) => x.text === text);
  if (!a) return;
  a.state = "approved";
  a.by = myName(s);
  s.history.push({ at: nowStr(), who: myName(s), kind: "alias_approved", order: null, text: `Approved “${text}” → ${a.sku}` });
}

export function aliasSet(s: D, text: string, sku: string) {
  const a = s.aliases.find((x) => x.text === text);
  if (a && sku) a.sku = sku;
}

export function aliasNo(s: D, text: string) {
  s.aliases = s.aliases.filter((x) => x.text !== text);
  s.history.push({ at: nowStr(), who: myName(s), kind: "alias_rejected", order: null, text: `Rejected “${text}”` });
}

/* ---- retention ---- */

/** Off: confirmed rows are not kept, and Confirm is hidden elsewhere. */
export function setRetainsRows(s: D, on: boolean) {
  s.settings.retainsRows = on;
}

export function setRetentionDays(s: D, days: number) {
  s.settings.retentionDays = days;
}

/* ---- replies ---- */

export function setReplyStyle(s: D, text: string) {
  s.settings.style = text;
}

export function toggleReply(s: D, k: keyof ReplyOptions) {
  const r = replyOpt(s.settings);
  s.settings.reply = { ...r, [k]: !r[k] };
}

/* ---- assistant access ---- */

/** A made-up key string for the demo: "pot_" and 36 random hex characters. It opens nothing. */
export function demoKey(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return "pot_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Adds a read-only key for this person; only the masked form is kept. */
export function createKey(s: D, personId: string, raw: string) {
  const p = s.people.find((x) => x.id === personId);
  if (!p) return;
  s.keys.push({ id: "k" + ++s.seq, label: `${p.name}'s key`, who: ROLES[p.role], masked: raw.slice(0, 8) + "…" + raw.slice(-4) });
  s.history.push({ at: nowStr(), who: myName(s), kind: "key_created", order: null, text: `Created a read-only key for ${p.name}` });
}

export function revokeKey(s: D, id: string) {
  s.keys = s.keys.filter((k) => k.id !== id);
}
