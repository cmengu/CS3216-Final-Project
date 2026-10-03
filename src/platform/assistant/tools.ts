/*
 * The assistant's three lookups, ported from the prototype's TOOLS. They read the demo state
 * through the person's view: an account manager only ever reaches their own customers' orders,
 * and someone who cannot see prices never gets an event that mentions an amount.
 */
import { canPrice, visibleOrders } from "@/platform/access";
import type { DemoState, Order, OrderEvent, Person } from "@/sample";
import { ref } from "@/lib/format";

export interface FindParams {
  /** Lower-cased customer name; matches when the customer's name contains it. */
  customer?: string;
  /** "open" = not delivered or draft; "needs" = needs check or blocked; otherwise an exact state. */
  state?: string;
  /** Delivery date, YYYY-MM-DD. */
  date?: string;
  /** Order references (PO numbers or WA-… refs). */
  ids?: string[];
}

/** A dollar amount in free text, e.g. "$12", "$1,240.50", "S$ 80". */
export const MONEY = /\$\s?\d/;

export interface Tools {
  find_orders: (p: FindParams) => Order[];
  open_order: (p: { id: string }) => Order[];
  order_history: (p: { id: string }) => OrderEvent[];
}

export function tools(s: DemoState, me: Person): Tools {
  const orders = () => visibleOrders(s.orders, me);
  const priced = canPrice(me);
  return {
    find_orders: (p) =>
      orders().filter(
        (o) =>
          (!p.customer || s.customers[o.cust].name.toLowerCase().includes(p.customer)) &&
          (!p.state ||
            (p.state === "open"
              ? !["delivered", "draft"].includes(o.state)
              : p.state === "needs"
                ? ["needs_check", "blocked"].includes(o.state)
                : o.state === p.state)) &&
          (!p.date || o.date === p.date) &&
          (!p.ids || p.ids.includes(ref(o))),
      ),
    open_order: (p) => orders().filter((o) => o.id === p.id),
    order_history: (p) =>
      orders().some((o) => o.id === p.id)
        ? s.events.filter((e) => e.order === p.id && e.kind !== "price_viewed" && (priced || !MONEY.test(e.text)))
        : [],
  };
}
