/*
 * The Invoices page's data, as the prototype's invoicesView() and invCsv() build it:
 * delivered orders in this person's view, split into "To invoice" and "Invoiced", grouped by customer.
 */
import type { DemoState, Order, OrderEvent, Person } from "@/sample";
import { canPrice, visibleOrders } from "@/platform/access";
import { orderTotal, ref } from "@/lib/format";

export type InvoiceTab = "open" | "done";

export function invoiceLists(s: Pick<DemoState, "orders">, u: Person) {
  const mine = visibleOrders(s.orders, u).filter((o) => o.state === "delivered");
  return { open: mine.filter((o) => !o.invoiced), done: mine.filter((o) => !!o.invoiced) };
}

export interface InvoiceGroup {
  cust: string;
  orders: Order[]; // newest delivery date first
  total: number;
}

/** Group by customer in the order the orders appear, each group's orders newest first. */
export function groupByCustomer(list: Order[]): InvoiceGroup[] {
  const byC = new Map<string, Order[]>();
  list.forEach((o) => {
    if (!byC.has(o.cust)) byC.set(o.cust, []);
    byC.get(o.cust)!.push(o);
  });
  return [...byC].map(([cust, os]) => ({
    cust,
    orders: [...os].sort((a, b) => b.date.localeCompare(a.date)),
    total: os.reduce((a, o) => a + orderTotal(o), 0),
  }));
}

export const listTotal = (list: Order[]) => list.reduce((a, o) => a + orderTotal(o), 0);

/** The day the order was marked delivered (the last such event), or its delivery date. */
export const deliveredOn = (events: OrderEvent[], o: Order) =>
  events.filter((e) => e.order === o.id && e.kind === "delivered").pop()?.at.slice(0, 10) || o.date;

/** The CSV the Copy CSV button copies: the tab on screen, with the total left blank for roles without prices. */
export function invoiceCsv(s: Pick<DemoState, "orders" | "customers">, u: Person, tab: InvoiceTab): string {
  const { open, done } = invoiceLists(s, u);
  const list = tab === "open" ? open : done;
  return [
    "Customer,Customer ID,PO,Delivered,Lines,Total,Invoice",
    ...list.map(
      (o) =>
        `${s.customers[o.cust].name},${o.cust},${ref(o)},${o.date},${o.lines.length},${canPrice(u) ? orderTotal(o).toFixed(2) : ""},${o.invoiced || ""}`,
    ),
  ].join("\n");
}
