/*
 * Confirm. The one place that would POST the reviewed rows to the server; for the demo there
 * is no database yet, so submitConfirm writes confirmed orders into the demo store instead,
 * in the shape the seeded orders use, with the events the prototype's confirmAll records.
 */
import { readerLabel, type ConfirmPayload, type EgcOutputRow } from "@/lib/importer";
import { nowStr } from "@/lib/format";
import { PRODUCTS } from "@/sample";
import type { DemoState, HistoryEntry, Order, OrderEvent, OrderLine } from "@/sample";
import { getState, meOf, update } from "@/state/demo-store";

/** What the demo store needs besides the payload. The server gets these from the session and the upload record. */
export interface ConfirmContext {
  by: string;
  at: string;
  /** File sizes by file name, for the order's source-file card. */
  sizes: Record<string, number>;
}

function lineOf(row: EgcOutputRow, s: Pick<DemoState, "customers">, cust: string): OrderLine {
  const sku = row.cells.sku.value;
  const unit = (row.cells.quantity.sourceText || (sku && PRODUCTS[sku]?.unit) || "box").toLowerCase();
  const manual = Object.values(row.cells).some((c) => c.origin === "manual" && c.value !== null);
  return {
    sku,
    qty: row.cells.quantity.value ?? 0,
    unit,
    outlet: row.source.outlet || s.customers[cust]?.outlets[0] || "",
    origin: manual ? "manual" : "po",
  };
}

/**
 * The confirmed orders and their events, from a payload. A PO whose rows name several
 * customers becomes one order per customer.
 */
export function confirmedFrom(payload: ConfirmPayload, s: Pick<DemoState, "customers" | "seq">, ctx: ConfirmContext) {
  let seq = s.seq;
  const orders: Order[] = [];
  const events: OrderEvent[] = [];
  const history: HistoryEntry[] = [];
  const ev = (order: string, kind: string, actor: string, text: string) => {
    events.push({ order, at: ctx.at, kind, actor, text });
    history.push({ at: ctx.at, who: actor, kind, order, text });
  };
  for (const co of payload.orders) {
    const byCust = new Map<string, EgcOutputRow[]>();
    for (const r of co.rows) {
      const c = r.cells.customerId.value ?? "";
      byCust.set(c, [...(byCust.get(c) ?? []), r]);
    }
    for (const [cust, rows] of byCust) {
      const po = rows[0].cells.poNumber.value?.trim() || null;
      const o: Order = {
        id: "o" + ++seq,
        cust,
        po,
        date: rows[0].cells.orderDate.value ?? ctx.at.slice(0, 10),
        state: "confirmed",
        source: co.source.kind === "pdf" ? "pdf" : "whatsapp",
        exported: true,
        confirmedBy: ctx.by,
        lines: rows.map((r) => lineOf(r, s, cust)),
      };
      if (co.source.kind === "pdf") {
        const fp = co.fingerprints;
        o.file = { name: co.source.fileName, size: ctx.sizes[co.source.fileName] ?? 0, at: ctx.at, hash: (fp.fileHash ?? fp.contentHash).slice(0, 8), contentHash: fp.contentHash };
      }
      orders.push(o);
      const n = o.lines.length;
      ev(o.id, "read", "Reader", `Read ${o.source === "pdf" && po ? `PO ${po} (${readerLabel(co.readerId)} layout)` : "WhatsApp order"} · ${n} lines`);
      ev(o.id, "confirmed", ctx.by, `Confirmed ${n} lines`);
      ev(o.id, "exported", ctx.by, "Exported to Excel");
    }
  }
  return { orders, events, history, seq };
}

/**
 * Sends the confirmed batch. Later: POST /api/orders/confirm with the payload. Today: writes the
 * orders into the demo store. Returns how many orders were confirmed.
 */
export async function submitConfirm(payload: ConfirmPayload, sizes: Record<string, number> = {}): Promise<number> {
  const s = getState();
  const made = confirmedFrom(payload, s, { by: meOf(s).name, at: nowStr(), sizes });
  update((d) => {
    d.orders.push(...made.orders);
    d.events.push(...made.events);
    d.history.push(...made.history);
    d.seq = made.seq;
  });
  return made.orders.length;
}
