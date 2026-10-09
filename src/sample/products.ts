import { SAMPLE_PRODUCTS } from "./egc-samples";
import type { Product } from "./types";

/* Invented products, with made-up prices, then the items on EGC's sample POs (egc-samples.ts, from a file git ignores). */
export const PRODUCTS: Record<string, Product> = {
  "EGC-PTND": { id: "EGC-PTND", name: "Pea tendrils 35g", unit: "box", price: 5.4 },
  "EGC-MBAS": { id: "EGC-MBAS", name: "Micro basil 50g", unit: "box", price: 6.2 },
  "EGC-RVSO": { id: "EGC-RVSO", name: "Red veined sorrel 35g", unit: "box", price: 5.8 },
  "EGC-NAST": { id: "EGC-NAST", name: "Nasturtium, variegated 20pc", unit: "box", price: 7.1 },
  "EGC-EFMX": { id: "EGC-EFMX", name: "Edible flower mix 50g", unit: "box", price: 9.8 },
  "EGC-ELDF": { id: "EGC-ELDF", name: "Elderflower 30g", unit: "box", price: 8.4 },
  "EGC-ESFR": { id: "EGC-ESFR", name: "Egyptian star flower, red 20pc", unit: "box", price: 6.6 },
  "EGC-WOOD": { id: "EGC-WOOD", name: "Wood sorrel 35g", unit: "box", price: 5.2 },
  ...SAMPLE_PRODUCTS,
};
