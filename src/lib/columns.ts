/* The Add orders table's columns and KH's header colours: yellow = from the PO, blue = from your lists, grey = computed. */
export const COLS: readonly (readonly [name: string, bg: string])[] = [
  ["Sheet", "#FFD966"],
  ["SKU", "#9FB5DC"],
  ["SKU Lookup", "#9FB5DC"],
  ["Quantity", "#FFD966"],
  ["Price", "#D9D9D9"],
  ["Total", "#D9D9D9"],
  ["Order Date", "#FFD966"],
  ["Date Converted", "#C6EFCE"],
  ["Customer", "#9FB5DC"],
  ["Customer ID", "#9FB5DC"],
  ["Delivery / Pickup", "#9FB5DC"],
  ["Location", "#9FB5DC"],
  ["AM / PM", "#9FB5DC"],
  ["PO Number", "#FFD966"],
  ["Sales Notes", "#FFD966"],
];

export const LAYOUTS = { egc: "EGC Tracker", packing: "Packing sheet" } as const;

/** The packing sheet drops the money and bookkeeping columns. */
const PACKING_HIDES = ["Price", "Total", "Sheet", "Date Converted"];

export const colOn = (cols: string[] | null, n: string) => !cols || cols.includes(n);

export function activeCols(layout: keyof typeof LAYOUTS, cols: string[] | null) {
  const base = layout === "packing" ? COLS.filter((c) => !PACKING_HIDES.includes(c[0])) : COLS;
  return base.filter((c) => colOn(cols, c[0]));
}

export function toggleCol(cols: string[] | null, n: string, on: boolean): string[] {
  const cur = cols || COLS.map((c) => c[0]);
  return on ? COLS.map((c) => c[0]).filter((x) => cur.includes(x) || x === n) : cur.filter((x) => x !== n);
}

/** The file queue's words (KH's vocabulary: validating → ready → processing → parsed | partial | unsupported | failed). */
export const QL = {
  validating: "Checking",
  ready: "Queued",
  processing: "Reading",
  parsed: "Ready",
  partial: "Needs review",
  unsupported: "Unsupported",
  failed: "Failed",
  duplicate: "Duplicate",
} as const;

export const stClass = (s: keyof typeof QL) =>
  s === "parsed" ? "ok" : s === "failed" || s === "unsupported" ? "fail" : s === "processing" || s === "validating" || s === "partial" ? "busy" : "wait";
