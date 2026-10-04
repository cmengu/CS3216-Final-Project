/* Invoice actions, as the prototype's invoice() and invoiceAll(). Pure apply steps (tested) plus store calls. */
"use client";

import type { DemoState } from "@/sample";
import { canInvoice, visibleOrders } from "@/platform/access";
import { meOf, update } from "@/state/demo-store";
import { nowStr } from "./customers";

/** The next invoice number: INV-2610-<100..999>, drawn from the demo's sequence. */
function nextInvoiceNo(s: DemoState): string {
  return "INV-2610-" + String((s.seq++ % 900) + 100);
}

/** Mark one delivered order invoiced; writes the order event and the history entry. Returns the number. */
export function applyInvoice(s: DemoState, orderId: string, at: string = nowStr()): string | null {
  const u = meOf(s);
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || !canInvoice(u) || o.state !== "delivered" || o.invoiced) return null;
  const n = nextInvoiceNo(s);
  o.invoiced = n;
  const text = `Invoiced ${n}`;
  s.events.push({ order: o.id, at, kind: "invoiced", actor: u.name, text });
  s.history.push({ at, who: u.name, kind: "invoiced", order: o.id, text });
  return n;
}

/** Mark every delivered, not yet invoiced order in this person's view invoiced. Returns how many. */
export function applyInvoiceAll(s: DemoState, at: string = nowStr()): number {
  const u = meOf(s);
  if (!canInvoice(u)) return 0;
  const os = visibleOrders(s.orders, u).filter((o) => o.state === "delivered" && !o.invoiced);
  os.forEach((o) => applyInvoice(s, o.id, at));
  return os.length;
}

export function invoice(orderId: string): string | null {
  let n: string | null = null;
  update((s) => {
    n = applyInvoice(s, orderId);
  });
  return n;
}

export function invoiceAll(): number {
  let n = 0;
  update((s) => {
    n = applyInvoiceAll(s);
  });
  return n;
}
