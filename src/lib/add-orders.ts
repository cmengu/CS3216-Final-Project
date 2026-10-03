/*
 * The app's side of Add orders: keeping the batch, telling the reviewer what happened to each
 * file, applying their choices and preparing what leaves the screen. Nothing here reads a PDF,
 * maps a line or checks a row; those come from the importer through @/lib/importer.
 */
import { COL_ID } from "@/lib/columns";
import { ref } from "@/lib/format";
import {
  businessKey,
  clipboardText,
  groupPoSheets,
  linesHash,
  setManualValue,
  type ConfirmPayload,
  type EgcColumnId,
  type EgcFingerprints,
  type EgcOutputRow,
  type EgcPurchaseOrder,
  type EgcValidationIssue,
} from "@/lib/importer";
import type { Alias, Order, OrderEvent, Product } from "@/sample";

/** A file's place in the queue, in the prototype's words (QL in columns.ts). */
export type AddStatus = "validating" | "ready" | "processing" | "parsed" | "partial" | "unsupported" | "failed" | "duplicate";

/** An order the importer read from one file in this batch, kept until Confirm or Start over. */
export interface ReadOrder {
  /** The queue file's id; the order's rows carry it as source.sourceId. */
  fileId: string;
  fileName: string;
  size: number;
  readerId: string;
  fingerprints: EgcFingerprints;
  order: EgcPurchaseOrder;
}

/** Files whose name is already queued (or repeats in the same drop) are skipped, as in the prototype. */
export function splitByName<F extends { name: string }>(queued: readonly { name: string }[], files: readonly F[]): { fresh: F[]; dup: number } {
  const names = new Set(queued.map((f) => f.name));
  const fresh: F[] = [];
  let dup = 0;
  for (const f of files) {
    if (names.has(f.name)) {
      dup++;
      continue;
    }
    names.add(f.name);
    fresh.push(f);
  }
  return { fresh, dup };
}

export const dupNotice = (n: number) => (n ? `${n} duplicate file${n === 1 ? " was" : "s were"} skipped` : "");

/**
 * The Duplicate detail when a PO with this content was already read in this batch or is a
 * confirmed order; null when it is new.
 */
export function duplicateDetail(
  contentHash: string,
  reads: readonly ReadOrder[],
  orders: readonly Order[],
  events: readonly OrderEvent[],
): string | null {
  const read = reads.find((r) => r.fingerprints.contentHash === contentHash);
  if (read) return `Same content as ${read.order.header.poNumber.trim() || read.fileName} · skipped`;
  const o = orders.find((x) => x.state !== "draft" && x.file?.contentHash === contentHash);
  if (!o) return null;
  const at = events.filter((e) => e.order === o.id && e.kind === "confirmed").pop()?.at;
  return `Same content as ${ref(o)}${at ? `, confirmed ${at.slice(11)}` : ""} · skipped`;
}

/** Cells that are filled together: one SKU pick fills four, one customer pick fills five. */
const FILL_GROUP: Partial<Record<string, string>> = {
  sku: "sku",
  skuLookup: "sku",
  price: "sku",
  total: "sku",
  customer: "customer",
  customerId: "customer",
  deliveryOrPickup: "customer",
  location: "customer",
  session: "customer",
};

/** How many values the reviewer has to give before these blockers clear. */
export function cellsToFill(blockers: readonly EgcValidationIssue[]): number {
  return new Set(blockers.map((b) => `${b.rowId}|${FILL_GROUP[b.field ?? ""] ?? b.field}`)).size;
}

/** The file list's detail for a read PO: "Buynow · 3 rows" or "Pavilion · 2 rows, 1 cell to fill". */
export function readDetail(label: string, rows: number, toFill: number): string {
  const r = `${label} · ${rows} row${rows === 1 ? "" : "s"}`;
  return toFill ? `${r}, ${toFill} cell${toFill === 1 ? "" : "s"} to fill` : r;
}

/** The importer columns to copy or download for the visible on-screen columns; no money for people who cannot see prices. */
export function exportColumns(visible: readonly string[], priced: boolean): EgcColumnId[] {
  return visible
    .map((n) => COL_ID[n])
    .filter((id): id is EgcColumnId => !!id && (priced || (id !== "price" && id !== "total")));
}

/**
 * Rows as they may leave the screen for this person. The importer notes a differing PO price
 * in Sales Notes ("PO price 4.50"); people who cannot see prices get that note blanked.
 */
export function exportRows(rows: readonly EgcOutputRow[], priced: boolean): EgcOutputRow[] {
  if (priced) return [...rows];
  return rows.map((r) => {
    const note = r.cells.salesNotes;
    const fromPrice = note.value !== null && note.sourceText !== undefined && note.sourceText === r.cells.price.sourceText;
    return fromPrice ? setManualValue(r, "salesNotes", null) : r;
  });
}

/**
 * Copy table, as the prototype copies it: a header row of the on-screen column names, then one
 * line per row, Sheet included. The cell values are the importer's clipboard text. People who
 * cannot see prices get no Price or Total column.
 */
export function copyTable(rows: readonly EgcOutputRow[], visible: readonly string[], priced: boolean): string {
  const ids = exportColumns(visible, priced);
  const names = visible.filter((n) => COL_ID[n] === null || ids.includes(COL_ID[n]!));
  const sheets = sheetOf(rows);
  const body = rows.length ? clipboardText(exportRows(rows, priced), ids).split("\n") : [];
  const lines = body.map((line, i) => {
    const cells = line.split("\t");
    return names.map((n) => (COL_ID[n] === null ? (sheets.get(rows[i].id) ?? "") : cells[ids.indexOf(COL_ID[n]!)])).join("\t");
  });
  return [names.join("\t"), ...lines].join("\n");
}

/** Each row's worksheet name, as the Excel download names it (one sheet per PO). */
export function sheetOf(rows: readonly EgcOutputRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sheet of groupPoSheets(rows)) for (const r of sheet.rows) out.set(r.id, sheet.name);
  return out;
}

/** The reviewer picked a product for a line: SKU, SKU Lookup and Price as typed values, so Total recomputes. */
export function pickSku(row: EgcOutputRow, product: Product): EgcOutputRow {
  const withSku = setManualValue(row, "sku", product.id);
  const withName = setManualValue(withSku, "skuLookup", product.name);
  return setManualValue(withName, "price", product.price);
}

/** Records the picked wording as a proposed alias for the owner to approve (the prototype's pick()). */
export function proposeAlias(aliases: readonly Alias[], text: string, sku: string, seen: string): Alias[] {
  const i = aliases.findIndex((a) => a.text === text);
  if (i < 0) return [...aliases, { text, sku, state: "proposed", by: null, seen }];
  return aliases.map((a, k) => (k === i ? { ...a, sku, state: "proposed" } : a));
}

/** After rows are mapped again (a customer was picked), the reviewer's own values carry over. */
export function keepManual(prev: readonly EgcOutputRow[], next: readonly EgcOutputRow[]): EgcOutputRow[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  return next.map((row) => {
    const old = byId.get(row.id);
    if (!old) return row;
    let out = row;
    for (const id of Object.keys(old.cells) as EgcColumnId[]) {
      const c = old.cells[id];
      if (c.origin === "manual" && c.value !== null) out = setManualValue(out, id, c.value as never);
    }
    return out;
  });
}

/** What Confirm sends: per read order, its reviewed rows and fingerprints. Never the PDF. */
export async function buildPayload(reads: readonly ReadOrder[], rows: readonly EgcOutputRow[]): Promise<ConfirmPayload> {
  const withRows = reads.filter((r) => rows.some((x) => x.source.sourceId === r.fileId));
  return {
    orders: await Promise.all(
      withRows.map(async (read) => {
        const orderRows = rows.filter((x) => x.source.sourceId === read.fileId);
        const first = orderRows[0].cells;
        const customerId = first.customerId.value ?? "";
        const poNumber = first.poNumber.value?.trim() ?? "";
        const key = poNumber
          ? businessKey({ customerId, poNumber })
          : businessKey({ customerId, deliveryDate: first.orderDate.value ?? "", linesHash: await linesHash(orderRows) });
        return { source: read.order.source, readerId: read.readerId, fingerprints: read.fingerprints, businessKey: key, rows: orderRows };
      }),
    ),
  };
}
