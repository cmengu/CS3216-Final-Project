/*
 * The lists the importer maps against: EGC's SKU List and Customer Database as the library's
 * EgcMasterData, built from the app's own invented products and customers. One place; later
 * these come from database tables.
 *
 * Outlets: one Customer ID per customer. Every outlet of a customer maps to that customer
 * through a buyer-wide alias (outlet ''), so a PO split across kitchens stays one customer.
 */
import type { EgcMasterData, EgcProductAlias } from "@/lib/importer";
import { CUSTOMERS } from "./customers";
import { seedAliases } from "./orders";
import { PRODUCTS } from "./products";
import type { Alias, Customer, Product } from "./types";

/**
 * Buyer names as the customers print them on their POs, besides the customer's own name.
 * Approved wording, kept as data; invented like everything in this folder.
 */
export const PRINTED_BUYERS: Record<string, string[]> = {
  C10243: ["Harbour Hotel Pte Ltd"],
  C10310: ["Marina Grand Hotel Singapore", "Marina Grand Hotel Pte Ltd, trading as Marina Grand Hotel Singapore"],
  C10388: ["Pavilion Kitchen Pte Ltd"],
  C10402: ["Riverside Club"],
  C10419: ["Orchard Deli Pte Ltd"],
};

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
    customerAliases: Object.values(customers).flatMap((c) =>
      [c.name, ...(PRINTED_BUYERS[c.id] ?? [])].map((buyerName) => ({ buyerName, outlet: "", customerId: c.id })),
    ),
  };
}
