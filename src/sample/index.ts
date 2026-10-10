import { CUSTOMERS } from "./customers";
import { seedAliases, seedEvents, seedMessages, seedOrders, seedToCheck } from "./orders";
import { PEOPLE } from "./people";
import { PRODUCTS } from "./products";
import type { DemoState } from "./types";

export * from "./types";
export { CUSTOMERS } from "./customers";
export { PEOPLE, ROLES } from "./people";
export { PRODUCTS } from "./products";

/* Everything here is invented. Never put a real PO, product, customer or price in this folder. */
export const COMPANY = "Edible Garden City";
export const APP_NAME = "PO Tracker";
export const GROUP_LOGIN = "orders@ediblegardencity.example";
/** The demo's fixed "today", as in the prototype. */
export const TODAY = "2026-10-01";

/** A fresh copy of the demo state. "Reset demo data" goes back to this. */
export function seed(): DemoState {
  return structuredClone({
    customers: CUSTOMERS,
    people: PEOPLE,
    orders: seedOrders(),
    events: seedEvents(),
    messages: seedMessages(),
    toCheck: seedToCheck(),
    aliases: seedAliases(),
    history: [],
    drafts: [],
    comments: [],
    keys: [],
    settings: {
      retainsRows: true,
      retentionDays: 365,
      skuCount: Object.keys(PRODUCTS).length,
      skuDate: "30 Sep",
      style: "Hi Chef, received your order, thanks! Delivering as below.",
    },
    cx: { mail: null, mailFlow: null, paste: false, wa: null },
    mailbox: null,
    user: "u2",
    chat: [],
    seq: 100,
  } satisfies DemoState);
}
