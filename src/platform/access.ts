/*
 * One place that applies the role. Pure functions for now; later this file runs on the
 * server (me() from a signed session cookie) and pages read only through it.
 * Matches "Who sees what" in the build spec (rev3) and the prototype's People table.
 */
import { PRODUCTS } from "@/sample/products";
import type { Order, OrderLine, Person, Product, Role } from "@/sample/types";

const PRICE_ROLES: readonly Role[] = ["owner", "coordinator", "finance"];
const EDIT_ROLES: readonly Role[] = ["owner", "coordinator"];
const DELIVER_ROLES: readonly Role[] = ["owner", "coordinator", "packing"];
const INVOICE_ROLES: readonly Role[] = ["owner", "finance"];
const PIN_ROLES: readonly Role[] = ["owner", "finance"];

/** Sees unit prices, totals and amounts. */
export const canPrice = (p: Person): boolean => PRICE_ROLES.includes(p.role);
/** Add orders, Confirm, Unconfirm, review changes. */
export const canEdit = (p: Person): boolean => EDIT_ROLES.includes(p.role);
/** Mark delivered. */
export const canDeliver = (p: Person): boolean => DELIVER_ROLES.includes(p.role);
/** Invoices page, Mark invoiced. */
export const canInvoice = (p: Person): boolean => INVOICE_ROLES.includes(p.role);
/** People, Settings, all of History. */
export const isOwner = (p: Person): boolean => p.role === "owner";
/** Owner and Finance confirm their tile with a four-digit PIN. */
export const needsPin = (p: Person): boolean => PIN_ROLES.includes(p.role);

/** Whether this person looks after this customer. */
export const seesCustomer = (p: Person, customerId: string): boolean =>
  p.customers === "all" || p.customers.includes(customerId);

/** The orders this person may see: all, or only their own customers' (account managers). */
export const visibleOrders = <O extends Pick<Order, "cust">>(orders: readonly O[], p: Person): O[] =>
  orders.filter((o) => seesCustomer(p, o.cust));

export type PricedLine = OrderLine & { unitPrice: number | null; total: number | null };

/**
 * The order's lines in this person's view. Price roles get unit price and line total;
 * everyone else gets the lines with no price fields at all (stripped, not blanked).
 */
export function lines(order: Pick<Order, "lines">, p: Person, products: Record<string, Product> = PRODUCTS): OrderLine[] | PricedLine[] {
  if (!canPrice(p)) {
    return order.lines.map((l) => {
      const copy: Record<string, unknown> = { ...l };
      delete copy.unitPrice;
      delete copy.total;
      return copy as unknown as OrderLine;
    });
  }
  return order.lines.map((l) => {
    const unitPrice = l.sku && products[l.sku] ? products[l.sku].price : null;
    return { ...l, unitPrice, total: unitPrice === null ? null : unitPrice * l.qty };
  });
}

export type NavKey = "home" | "orders" | "add" | "customers" | "invoices" | "people" | "history" | "settings";

/** Which rail items and routes this person may open. */
export function navAllowed(key: NavKey, p: Person): boolean {
  if (key === "add") return canEdit(p);
  if (key === "invoices") return canInvoice(p);
  if (key === "people" || key === "settings") return isOwner(p);
  return true;
}
