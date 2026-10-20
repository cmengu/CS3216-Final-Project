/*
 * Reading a master list file in the browser: CSV parsing, finding the columns, and the one
 * sentence that says why a file can't be used. Pure functions, so they are tested on their own.
 */

export interface MasterItem {
  supplier: string;
  po: string;
  item: string;
  description: string;
  unit: string;
  currency: string;
  /** Agreed unit price, as written in the file (kept as text so no digits are lost). */
  price: string;
  /** Discount as a fraction (0.05 = 5%), or 0. */
  discount: number;
  validFrom: string;
  validTo: string;
}

/** Split CSV text into rows of cells. Handles quoted cells, doubled quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Header text in lower case with punctuation read as spaces: "Unit_Price" → "unit price". */
const fold = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The columns a master list needs, each with the header wordings it accepts. */
const REQUIRED = {
  supplier: { name: "supplier", words: ["supplier", "supplier name", "vendor"] },
  item: { name: "item", words: ["item", "item code", "part number", "part no", "part code", "product code", "stock code", "sku"] },
  unit: { name: "unit", words: ["uom", "unit", "unit of measure"] },
  price: { name: "unit price", words: ["unit price", "price", "agreed price", "agreed unit price"] },
} as const;

const OPTIONAL: Record<"po" | "description" | "currency" | "discount" | "validFrom" | "validTo", string[]> = {
  po: ["po", "po number", "purchase order"],
  description: ["description", "item description"],
  currency: ["currency", "ccy"],
  discount: ["discount", "discount rate"],
  validFrom: ["valid from", "start date"],
  validTo: ["valid to", "end date"],
};

type Key = keyof typeof REQUIRED | keyof typeof OPTIONAL;

function columns(header: string[]): Partial<Record<Key, number>> {
  const folded = header.map(fold);
  const out: Partial<Record<Key, number>> = {};
  const all: [Key, readonly string[]][] = [
    ...(Object.entries(REQUIRED) as [Key, { words: readonly string[] }][]).map(([k, v]) => [k, v.words] as [Key, readonly string[]]),
    ...(Object.entries(OPTIONAL) as [Key, string[]][]),
  ];
  for (const [key, words] of all) {
    const at = folded.findIndex((h) => words.includes(h));
    if (at >= 0) out[key] = at;
  }
  return out;
}

export type ParseResult = { ok: true; items: MasterItem[] } | { ok: false; reason: string };

/** A discount written as 0.05, 5 or 5%, as a fraction. */
function fraction(v: string): number {
  const n = Number(v.replace("%", "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return v.includes("%") || n > 1 ? n / 100 : n;
}

/** Turn CSV text into master list items, or say in one sentence why it can't be used. */
export function readMasterCsv(text: string): ParseResult {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, reason: "The file is empty." };
  const col = columns(rows[0]);
  for (const [key, req] of Object.entries(REQUIRED)) {
    if (col[key as Key] === undefined) return { ok: false, reason: `It has no ${req.name} column.` };
  }
  const cell = (r: string[], k: Key) => (col[k] === undefined ? "" : (r[col[k]!] ?? "").trim());
  const items: MasterItem[] = [];
  for (const r of rows.slice(1)) {
    const price = cell(r, "price").replace(/,/g, "");
    if (!cell(r, "item") && !price) continue;
    if (price === "" || !Number.isFinite(Number(price))) return { ok: false, reason: `Row ${items.length + 2} has no price.` };
    items.push({
      supplier: cell(r, "supplier"),
      po: cell(r, "po"),
      item: cell(r, "item"),
      description: cell(r, "description"),
      unit: cell(r, "unit"),
      currency: cell(r, "currency"),
      price,
      discount: fraction(cell(r, "discount")),
      validFrom: cell(r, "validFrom"),
      validTo: cell(r, "validTo"),
    });
  }
  if (!items.length) return { ok: false, reason: "It has no rows." };
  return { ok: true, items };
}

export const supplierCount = (items: MasterItem[]) => new Set(items.map((i) => i.supplier).filter(Boolean)).size;
