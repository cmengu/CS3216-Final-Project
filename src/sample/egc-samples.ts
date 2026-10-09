/*
 * The customers and items on EGC's own sample POs, so a PO like those matches on Add orders
 * with nothing to pick. The buyers, items and prices are real, so they are not in the repo:
 * they are read from egc-samples.private.json, which git ignores. Without that file
 * scripts/private-lists.mjs writes an empty one and the app runs on the invented lists alone.
 * In the file, buyer names, outlets, item codes and item wording are as those POs print them;
 * SKU codes and names follow EGC's sample output sheet where it shows them, and the rest are
 * placeholders in the same style, as are every Customer ID, Location and delivery slot, until
 * EGC's SKU List and Customer Database arrive. List price is the price the sample POs print.
 */
import type { EgcCustomerAlias, EgcProductAlias } from "@/lib/importer";
import PRIVATE from "./egc-samples.private.json";
import type { Customer, Product } from "./types";

const LOGO = '<path d="M4 20V7l8-4 8 4v13M9 20v-5h6v5M9 10h.01M15 10h.01"/>';

const { buyers: BUYERS, products: LISTED, items: ITEMS } = PRIVATE as unknown as {
  /** id, name, kind, PO layout, buyer as printed, outlets as printed, mark colour. */
  buyers: [string, string, string, string, string, string[], string][];
  /** SKU, name, list price. */
  products: [string, string, number][];
  /** customer, the item's code as printed ('' when the PO prints none), its wording as printed, SKU. */
  items: [string, string, string, string][];
};

export const SAMPLE_CUSTOMERS: Record<string, Customer> = Object.fromEntries(
  BUYERS.map(([id, name, kind, layout, , outlets, color]) => [
    id,
    {
      id,
      name,
      kind,
      color,
      logo: LOGO,
      layout,
      outlets,
      location: "Goods receiving",
      delivery: "Delivery",
      slot: "AM",
      sender: "Purchasing",
      channel: `Email (${layout} PO)`,
      days: "",
      terms: "",
      notes: [],
    } satisfies Customer,
  ]),
);

/** Each buyer as its POs print it, approved for every outlet of that buyer. */
export const SAMPLE_PRINTED_CUSTOMERS: EgcCustomerAlias[] = BUYERS.map(([customerId, , , , buyerName]) => ({ buyerName, outlet: "", customerId }));

export const SAMPLE_PRODUCTS: Record<string, Product> = Object.fromEntries(
  LISTED.map(([id, name, price]) => [id, { id, name, unit: "box", price } satisfies Product]),
);

/** Each item by its printed code and by its printed wording, approved for the customer that prints it. */
export const SAMPLE_PRINTED_ITEMS: EgcProductAlias[] = ITEMS.flatMap(([customerId, code, wording, sku]) =>
  [code, wording].filter((sourceText) => sourceText && sourceText !== sku).map((sourceText) => ({ customerId, sourceText, sku })),
);
