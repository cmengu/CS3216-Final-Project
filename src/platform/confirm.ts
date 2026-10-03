/*
 * Confirm. The one place that would POST the reviewed rows to the server; for the demo there
 * is no database yet, so submitConfirm turns the drafts the payload was built from into
 * confirmed orders in the demo store, with the events the prototype's confirmAll records.
 */
import type { ConfirmPayload } from "@/lib/importer";
import { custOf, nowStr } from "@/lib/format";
import type { DemoState } from "@/sample";
import { addEvent, type Ctx } from "@/state/actions/orders";
import { getState, meOf, update } from "@/state/demo-store";

/**
 * The prototype's confirmAll on these drafts: each becomes confirmed and exported, keeps its id,
 * leaves the Add orders table, and gets the read, confirmed and exported events.
 */
export function confirmDrafts(s: DemoState, c: Ctx, ids: readonly string[]) {
  for (const id of ids) {
    const o = s.orders.find((x) => x.id === id);
    if (!o) continue;
    o.state = "confirmed";
    o.fromAdd = false;
    o.confirmedBy = c.me;
    o.exported = true;
    const n = o.lines.length;
    const layout = o.file?.layout || custOf(s.customers, o.cust).layout || "PDF";
    addEvent(s, c, id, "read", `Read ${o.po ? `PO ${o.po} (${layout} layout)` : "WhatsApp order"} · ${n} lines`, "Reader");
    addEvent(s, c, id, "confirmed", `Confirmed ${n} lines`);
    addEvent(s, c, id, "exported", "Exported to Excel");
  }
}

/**
 * Sends the confirmed batch. Later: POST /api/orders/confirm with the payload, and the server
 * creates the orders. Today: the drafts it was built from (ids, in the payload's order) become
 * confirmed orders in the demo store. Returns how many orders were confirmed.
 */
export async function submitConfirm(payload: ConfirmPayload, ids: readonly string[]): Promise<number> {
  if (payload.orders.length !== ids.length) throw new Error("Each confirmed order needs its draft");
  const c: Ctx = { me: meOf(getState()).name, at: nowStr() };
  update((d) => confirmDrafts(d, c, ids));
  return ids.length;
}
