/*
 * The lists the importer maps against: EGC's SKU List and Customer Database as the library's
 * EgcMasterData, built from the app's own invented products and customers. One place; later
 * these come from database tables.
 *
 * Outlets: one Customer ID per customer. A customer whose kitchens share that ID is approved
 * per kitchen and buyer-wide, and the importer appends the kitchen to Location. A customer with
 * one outlet is approved for that outlet only, so its Location stays as listed.
 */
import type { EgcCustomerAlias, EgcMasterData, EgcProductAlias } from "@/lib/importer";
import { CUSTOMERS } from "./customers";
import { seedAliases } from "./orders";
import { PRODUCTS } from "./products";
import type { Alias, Customer, Product } from "./types";

/** Buyer and outlet as the customers print them on their POs. Approved wording, kept as data; invented. */
export const PRINTED_CUSTOMERS: EgcCustomerAlias[] = [
  { buyerName: "HARBOUR HOTEL PTE LTD", outlet: "HHBQT", customerId: "C10243" },
  { buyerName: "HARBOUR HOTEL PTE LTD", outlet: "HHIRD", customerId: "C10243" },
  { buyerName: "Harbour Hotel Pte Ltd", outlet: "", customerId: "C10243" },
  { buyerName: "Marina Grand Hotel Singapore", outlet: "2101-Kitchen #1", customerId: "C10310" },
  { buyerName: "Marina Grand Hotel Singapore", outlet: "2105-Kitchen #5 Madame Fan", customerId: "C10310" },
  { buyerName: "Marina Grand Hotel Singapore", outlet: "2110-In Room Dining", customerId: "C10310" },
  { buyerName: "Marina Grand Hotel Singapore", outlet: "", customerId: "C10310" },
  { buyerName: "Marina Grand Hotel Pte Ltd, trading as Marina Grand Hotel Singapore", outlet: "", customerId: "C10310" },
  { buyerName: "Pavilion Kitchen Pte Ltd", outlet: "Pavilion Kitchen - Dempsey", customerId: "C10388" },
  { buyerName: "Orchard Deli Pte Ltd", outlet: "", customerId: "C10419" },
];

/**
 * The outlet as the customer prints it, to the outlet name staff use (the customer's outlets).
 * Invented, like the rest; a printed outlet not listed keeps its printed name.
 */
export const PRINTED_OUTLETS: Record<string, Record<string, string>> = {
  C10243: { HHBQT: "Banquet kitchen", HHIRD: "Room service" },
  C10310: { "2101-Kitchen #1": "Kitchen #1", "2105-Kitchen #5 Madame Fan": "Madame Fan", "2110-In Room Dining": "Room service", "IRD Kitchen": "Room service" },
  C10388: { "Pavilion Kitchen - Dempsey": "Main" },
};

/** The staff outlet name for an outlet printed on a customer's PO. */
export const outletOf = (customerId: string, printed: string): string => PRINTED_OUTLETS[customerId]?.[printed] ?? printed;

/** Customers approved per outlet only; the rest are also approved buyer-wide under their own name. */
const ONE_OUTLET = new Set(["C10388"]);

/** Item wording the customers print, approved for one customer. */
export const PRINTED_ITEMS: EgcProductAlias[] = [
  // Harbour Hotel prints long descriptions.
  { customerId: "C10243", sourceText: "MICROGREEN PEA SHOOTS LOCAL FARM 35G BOX GRADE A", sku: "EGC-PTND" },
  { customerId: "C10243", sourceText: "MICROGREEN BASIL GREEN 50G BOX GRADE A", sku: "EGC-MBAS" },
  { customerId: "C10243", sourceText: "SORREL RED VEIN LEAF 35G BOX GRADE A", sku: "EGC-RVSO" },
  { customerId: "C10243", sourceText: "NASTURTIUM LEAF VARIEGATED 20 PCS BOX GRADE A", sku: "EGC-NAST" },
  { customerId: "C10243", sourceText: "EDIBLE FLOWERS ASSORTED 50G BOX GRADE A", sku: "EGC-EFMX" },
  { customerId: "C10243", sourceText: "SORREL WOOD LEAF 35G BOX GRADE A", sku: "EGC-WOOD" },
  // Marina Grand prints its own item codes.
  { customerId: "C10310", sourceText: "MG00001101", sku: "EGC-PTND" },
  { customerId: "C10310", sourceText: "MG00001102", sku: "EGC-MBAS" },
  { customerId: "C10310", sourceText: "MG00001103", sku: "EGC-ELDF" },
  { customerId: "C10310", sourceText: "MG00001104", sku: "EGC-EFMX" },
  { customerId: "C10310", sourceText: "MG-F0101", sku: "EGC-WOOD" },
  { customerId: "C10310", sourceText: "MG-F0102", sku: "EGC-ESFR" },
  { customerId: "C10310", sourceText: "MG-F0103", sku: "EGC-RVSO" },
];

export function buildLists(
  products: Record<string, Product> = PRODUCTS,
  customers: Record<string, Customer> = CUSTOMERS,
  aliases: readonly Alias[] = seedAliases(),
): EgcMasterData {
  const skus = Object.values(products).map((p) => ({ sku: p.id, description: p.name, unitPrice: p.price }));
  const productAliases: EgcProductAlias[] = [
    // A PO that prints EGC's own code or name needs no further alias.
    ...Object.values(products).flatMap((p) => [
      { customerId: null, sourceText: p.id, sku: p.id },
      { customerId: null, sourceText: p.name, sku: p.id },
    ]),
    ...aliases
      .filter((a): a is Alias & { sku: string } => a.state === "approved" && !!a.sku && !!products[a.sku])
      .map((a) => ({ customerId: null, sourceText: a.text, sku: a.sku })),
    ...PRINTED_ITEMS,
  ];
  return {
    skus,
    customers: Object.values(customers).map((c) => ({
      customerId: c.id,
      name: c.name,
      location: c.location,
      deliveryMethod: c.delivery,
      session: c.slot,
    })),
    productAliases,
    customerAliases: [
      ...PRINTED_CUSTOMERS.filter((a) => customers[a.customerId]),
      ...Object.values(customers)
        .filter((c) => !ONE_OUTLET.has(c.id))
        .map((c) => ({ buyerName: c.name, outlet: "", customerId: c.id })),
    ],
  };
}
