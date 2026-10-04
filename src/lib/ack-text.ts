/*
 * The acknowledgement a person sends back once an order is confirmed (prototype: ackText, replyOpt).
 * Pure: the caller passes the customer, the settings and who is sending.
 */
import { COMPANY, PRODUCTS } from "@/sample";
import type { Customer, DemoState, Order, Product, ReplyOptions, Settings } from "@/sample";
import { fmtDay } from "./format";
import { custOf } from "@/lib/format";

export const DEFAULT_REPLY: ReplyOptions = { lines: true, date: true, sign: true };

/** The reply options in force: the saved ones, or all on until someone changes them. */
export const replyOpt = (settings: Pick<Settings, "reply">): ReplyOptions => settings.reply ?? DEFAULT_REPLY;

export interface AckContext {
  customer: Pick<Customer, "slot">;
  /** The opening line (Settings › Replies). */
  style: string;
  reply?: ReplyOptions;
  /** The person who taps send; signs the reply when reply.sign is on. */
  sender: string;
  company?: string;
  products?: Record<string, Product>;
}

export function ackText(o: Pick<Order, "po" | "date" | "lines">, ctx: AckContext): string {
  const r = ctx.reply ?? DEFAULT_REPLY;
  const products = ctx.products ?? PRODUCTS;
  const c = ctx.customer;
  const head = [o.po ? "PO " + o.po : "", r.date ? `Delivery ${fmtDay(o.date)}, ${c.slot === "Unspecified" ? "time to confirm" : c.slot}` : ""]
    .filter(Boolean)
    .join(" · ");
  const lines = r.lines
    ? o.lines.map((l) => `• ${l.sku ? (products[l.sku]?.name ?? l.sku) : l.desc} · ${l.qty} ${l.unit} · ${l.outlet}`).join("\n")
    : "";
  return [ctx.style, [head && lines ? head + ":" : head, lines].filter(Boolean).join("\n"), r.sign ? `${ctx.sender}, ${ctx.company ?? COMPANY}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/** ackText with everything read from the demo state, signed by the person working now. */
export function ackTextFor(s: DemoState, o: Order): string {
  const me = s.people.find((p) => p.id === s.user) ?? s.people[0];
  return ackText(o, { customer: custOf(s.customers, o.cust), style: s.settings.style, reply: replyOpt(s.settings), sender: me.name });
}
