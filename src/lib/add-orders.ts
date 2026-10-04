/*
 * The app's side of Add orders, as pure functions over the demo state's shapes. As in the
 * prototype, a PO read on Add orders is already an order with state "draft" and fromAdd set;
 * the Step 3 table is the list of those drafts. Each draft keeps the importer's rows beside it
 * (Order.read), and every value shown, copied, downloaded or confirmed is computed from those
 * rows through the importer's own functions. Nothing here reads a PDF, maps a line or checks a
 * row itself.
 */
import { COL_ID } from "@/lib/columns";
import { custOf, ref } from "@/lib/format";
import {
  businessKey,
  clipboardText,
  findDuplicate,
  groupPoSheets,
  linesHash,
  pickCustomer,
  pickSku,
  setManualValue,
  toRows,
  type ConfirmPayload,
  type EgcColumnId,
  type EgcFingerprints,
  type EgcMasterData,
  type EgcOrderSource,
  type EgcOutputRow,
  type EgcPurchaseOrder,
  type EgcValidationIssue,
} from "@/lib/importer";
import { PRODUCTS } from "@/sample";
import { outletOf } from "@/sample/lists";
import type { Alias, Customer, DemoState, Order, OrderEvent, OrderLine, OrderRead } from "@/sample";

export type { AddStatus } from "@/sample";

/* ------------------------------------------------------------------ queue ---- */

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

/** The file list's detail for a read PO: "Buynow · 3 rows" or "Buynow · 2 rows, 1 cell to fill". */
export function readDetail(label: string, rows: number, toFill: number): string {
  const r = `${label} · ${rows} row${rows === 1 ? "" : "s"}`;
  return toFill ? `${r}, ${toFill} cell${toFill === 1 ? "" : "s"} to fill` : r;
}

/* --------------------------------------------------------------- duplicates ---- */

/** Every order whose fingerprints are known: what a newly read file is compared with. */
export function knownOrders(orders: readonly Order[]) {
  return orders.flatMap((order) => {
    const contentHash = order.read?.fingerprints.contentHash || order.file?.contentHash;
    if (!contentHash) return [];
    return [{ contentHash, fileHash: order.read?.fingerprints.fileHash ?? order.file?.fileHash ?? null, order }];
  });
}

/**
 * The Duplicate detail when the file repeats an order already read (a confirmed order, or a
 * draft from this batch), found with the importer's findDuplicate; null when it is new.
 */
export function duplicateDetail(fingerprints: EgcFingerprints, orders: readonly Order[], events: readonly OrderEvent[]): string | null {
  const hit = findDuplicate(fingerprints, knownOrders(orders));
  if (!hit) return null;
  const o = hit.order;
  if (o.state === "draft") return `Same content as ${ref(o)} · skipped`;
  const at = events.filter((e) => e.order === o.id && e.kind === "confirmed").pop()?.at;
  return `Same content as ${ref(o)}${at ? `, confirmed ${at.slice(11)}` : ""} · skipped`;
}

/* ------------------------------------------------------------------ drafts ---- */

/** The drafts that came from Add orders, in store order: the Step 3 table (the prototype's `drafts`). */
export const addDrafts = (orders: readonly Order[]): Order[] => orders.filter((o) => o.state === "draft" && !!o.fromAdd);

/** The table's rows: each draft's stored rows, draft by draft. */
export const tableRows = (drafts: readonly Order[]): EgcOutputRow[] => drafts.flatMap((o) => o.read?.rows ?? []);

/** Where a table row lives: its draft and its line. */
export function rowIndex(drafts: readonly Order[]): Map<string, { order: Order; i: number }> {
  const out = new Map<string, { order: Order; i: number }>();
  for (const order of drafts) order.read?.rows.forEach((r, i) => out.set(r.id, { order, i }));
  return out;
}

/** A line was edited by staff when its SKU, quantity or price was typed or picked. */
const typed = (row: EgcOutputRow) => (["sku", "quantity", "price"] as const).some((k) => row.cells[k].origin === "manual" && row.cells[k].value !== null);

/**
 * One order line from one row, in the seeded orders' shape: the product's own unit (the PO's
 * only for a line with no SKU) when read, kept as it was on later edits, the staff's outlet name for the printed outlet, and the PO's
 * own wording in desc (shown when no SKU matched, and the text an alias is proposed for).
 */
export function lineOf(row: EgcOutputRow, c: Pick<Customer, "id" | "outlets">, desc: string, prev?: OrderLine): OrderLine {
  const sku = row.cells.sku.value;
  // A line keeps the unit it was read with: picking a SKU or typing a quantity does not change it (prototype: pick, setQty).
  const unit = prev?.unit || ((sku && PRODUCTS[sku]?.unit) || row.cells.quantity.sourceText || "box").toLowerCase();
  const outlet = prev?.outlet || (row.source.outlet && outletOf(c.id, row.source.outlet)) || c.outlets[0] || "";
  const origin = !sku ? "unresolved" : typed(row) || prev?.origin === "manual" ? "manual" : "po";
  return { sku, qty: row.cells.quantity.value ?? 0, unit, outlet, origin, desc };
}

/** What processing one file (or reading one paste) hands over to become drafts. */
export interface ReadInput {
  sourceId: string;
  fileName: string;
  size: number;
  at: string;
  readerId: string;
  readerLabel: string;
  source: EgcOrderSource;
  fingerprints: EgcFingerprints;
  rows: EgcOutputRow[];
  /** The PO's wording of each row's line, aligned with rows. */
  descs: string[];
  /** A pasted message's lines that are not items (the prototype's `unparsed`). */
  unparsed?: string[];
  /** The delivery date staff chose for a paste. */
  date?: string;
}

/**
 * The draft orders for one read PO, in the seeded orders' shape plus its rows (the prototype's
 * processFiles and parsePaste push one such order per PO). A PO whose rows name several
 * customers becomes one draft per customer; rows whose customer the lists could not find stay
 * together on a draft with no customer until one is picked.
 */
export function draftsFrom(input: ReadInput, s: Pick<DemoState, "customers" | "seq">): { orders: Order[]; seq: number } {
  let seq = s.seq;
  const groups = new Map<string, number[]>();
  input.rows.forEach((r, i) => {
    const c = r.cells.customerId.value ?? "";
    groups.set(c, [...(groups.get(c) ?? []), i]);
  });
  const pdf = input.source.kind === "pdf";
  const fp = input.fingerprints;
  const orders: Order[] = [...groups].map(([cust, idx]) => {
    const rows = idx.map((i) => input.rows[i]);
    const c = custOf(s.customers, cust);
    const o: Order = {
      id: "o" + ++seq,
      cust,
      po: pdf ? rows[0].cells.poNumber.value?.trim() || null : null,
      date: rows[0].cells.orderDate.value ?? input.date ?? input.at.slice(0, 10),
      state: "draft",
      source: pdf ? "pdf" : "whatsapp",
      fromAdd: true,
      exported: false,
      confirmedBy: null,
      file: pdf
        ? { name: input.fileName, size: input.size, at: input.at, hash: (fp.fileHash ?? fp.contentHash).slice(0, 8), contentHash: fp.contentHash, fileHash: fp.fileHash, layout: input.readerLabel }
        : { name: "WhatsApp paste", size: input.size, at: input.at, hash: "", contentHash: fp.contentHash },
      lines: rows.map((r, k) => lineOf(r, c, input.descs[idx[k]] ?? "")),
      read: { sourceId: input.sourceId, readerId: input.readerId, source: input.source, fingerprints: fp, rows },
    };
    if (!pdf) o.unparsed = input.unparsed ?? [];
    return o;
  });
  return { orders, seq };
}

/** After an edit to a draft's rows: its lines, delivery date and PO number follow the rows. */
export function syncDraft(o: Order, customers: Record<string, Customer>) {
  if (!o.read) return;
  const rows = o.read.rows;
  const c = custOf(customers, o.cust);
  o.lines = rows.map((r, i) => lineOf(r, c, o.lines[i]?.desc ?? r.cells.sku.sourceText ?? "", o.lines[i]));
  o.date = rows[0]?.cells.orderDate.value ?? o.date;
  if (o.source === "pdf") o.po = rows[0]?.cells.poNumber.value?.trim() || null;
}

/** The reviewer picked a SKU for a line: one pickSku fills SKU, SKU Lookup and Price, and Total follows. */
export function pickSkuIn(o: Order, rowId: string, sku: string, lists: EgcMasterData, customers: Record<string, Customer>) {
  if (!o.read) return;
  o.read.rows = pickSku(o.read.rows, rowId, sku, lists);
  syncDraft(o, customers);
}

/** The reviewer typed a quantity (the prototype's setQty: at least 1). */
export function setQtyIn(o: Order, rowId: string, typedQty: string, customers: Record<string, Customer>) {
  if (!o.read) return;
  const n = Math.max(1, parseInt(typedQty, 10) || 1);
  o.read.rows = o.read.rows.map((r) => (r.id === rowId ? setManualValue(r, "quantity", n) : r));
  syncDraft(o, customers);
}

/** The reviewer typed a value the PO did not give (an order date or a PO number). */
export function setCellIn(o: Order, rowId: string, column: "orderDate" | "poNumber", value: string, customers: Record<string, Customer>) {
  if (!o.read) return;
  o.read.rows = o.read.rows.map((r) => (r.id === rowId ? setManualValue(r, column, value) : r));
  syncDraft(o, customers);
}

/** The reviewer picked the customer the lists could not find: pickCustomer fills every row of the draft. */
export function pickCustomerIn(o: Order, customerId: string, lists: EgcMasterData, customers: Record<string, Customer>) {
  if (!o.read) return;
  let rows = o.read.rows;
  for (const r of rows) rows = pickCustomer(rows, r.id, customerId, lists);
  o.read.rows = rows;
  o.cust = customerId;
  const c = custOf(customers, customerId);
  o.lines = rows.map((r, i) => lineOf(r, c, o.lines[i]?.desc ?? "", o.lines[i] && { ...o.lines[i], outlet: "" }));
}

/** Records the picked wording as a proposed alias for the owner to approve (the prototype's pick()). */
export function proposeAlias(aliases: readonly Alias[], text: string, sku: string, seen: string): Alias[] {
  const i = aliases.findIndex((a) => a.text === text);
  if (i < 0) return [...aliases, { text, sku, state: "proposed", by: null, seen }];
  return aliases.map((a, k) => (k === i ? { ...a, sku, state: "proposed" } : a));
}

/** Whether the stored rows still say what the order's lines say (a review on the order page can change a line). */
const rowsMatch = (o: Order) =>
  !!o.read && o.read.rows.length === o.lines.length && o.read.rows.every((r, i) => r.cells.sku.value === o.lines[i].sku && r.cells.quantity.value === o.lines[i].qty);

/**
 * The rows of an order that goes back to the Add orders table (Unconfirm): the stored rows when
 * they still match its lines, else rows rebuilt from its lines by the importer's toRows, with
 * the customer assigned and each line under the product's own name.
 */
export function readFor(o: Order, lists: EgcMasterData, customers: Record<string, Customer>): OrderRead {
  if (o.read && rowsMatch(o)) return o.read;
  const pdf = o.source === "pdf";
  const source: EgcOrderSource = pdf ? { kind: "pdf", fileName: o.file?.name ?? `${ref(o)}.pdf`, readerId: o.read?.readerId ?? "" } : { kind: "whatsapp-paste" };
  const po: EgcPurchaseOrder = {
    source,
    header: {
      poNumber: o.po ?? "",
      buyerName: custOf(customers, o.cust).name,
      orderDate: o.date,
      deliveryDate: o.date,
      deliverTo: "",
      currency: "SGD",
      subtotal: null,
      taxAmount: null,
      grandTotal: null,
      remarks: "",
    },
    lines: o.lines.map((l, i) => ({
      lineNumber: i + 1,
      itemCode: "",
      description: l.sku ? (PRODUCTS[l.sku]?.name ?? l.sku) : (l.desc ?? ""),
      quantity: l.qty,
      unit: l.unit,
      unitPrice: null,
      discount: null,
      lineAmount: null,
      taxAmount: null,
      outlet: "",
      deliveryDate: null,
      evidence: [],
    })),
    assignedCustomerId: o.cust || null,
    warnings: [],
  };
  return {
    sourceId: o.id,
    readerId: o.read?.readerId ?? (pdf ? "" : "whatsapp-paste"),
    source,
    fingerprints: o.read?.fingerprints ?? { fileHash: o.file?.fileHash ?? null, contentHash: o.file?.contentHash ?? "" },
    rows: toRows([{ sourceId: o.id, order: po }], lists),
  };
}

/* ------------------------------------------------------------ leaving the screen ---- */

/** The importer columns to copy or download for the visible on-screen columns; no money for people who cannot see prices. */
export function exportColumns(visible: readonly string[], priced: boolean): EgcColumnId[] {
  return visible
    .map((n) => COL_ID[n])
    .filter((id): id is EgcColumnId => !!id && (priced || (id !== "price" && id !== "total")));
}

/**
 * Copy table, as the prototype copies it: a header line of the on-screen column names, then one
 * line per row. The values are the importer's clipboardText, with its Sheet column when Sheet
 * is on screen; people who cannot see prices get it with omitPrices (no Price, Total or
 * "PO price" note).
 */
export function copyTable(rows: readonly EgcOutputRow[], visible: readonly string[], priced: boolean): string {
  const ids = exportColumns(visible, priced);
  const names = visible.filter((n) => (COL_ID[n] === null ? true : ids.includes(COL_ID[n]!)));
  const body = rows.length ? clipboardText(rows, ids, { includeSheet: visible.includes("Sheet"), omitPrices: !priced }).split("\n") : [];
  return [names.join("\t"), ...body].join("\n");
}

/** Each row's worksheet name, as the Excel download names it (one sheet per PO). */
export function sheetOf(rows: readonly EgcOutputRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sheet of groupPoSheets(rows)) for (const r of sheet.rows) out.set(r.id, sheet.name);
  return out;
}

/** What Confirm sends: per draft, its reviewed rows and fingerprints. Never the PDF. */
export async function buildPayload(drafts: readonly Order[]): Promise<ConfirmPayload> {
  return {
    orders: await Promise.all(
      drafts
        .filter((o): o is Order & { read: OrderRead } => !!o.read && o.read.rows.length > 0)
        .map(async ({ read }) => {
          const first = read.rows[0].cells;
          const customerId = first.customerId.value ?? "";
          const poNumber = first.poNumber.value?.trim() ?? "";
          const key = poNumber
            ? businessKey({ customerId, poNumber })
            : businessKey({ customerId, deliveryDate: first.orderDate.value ?? "", linesHash: await linesHash(read.rows) });
          return { source: read.source, readerId: read.readerId, fingerprints: read.fingerprints, businessKey: key, rows: read.rows };
        }),
    ),
  };
}
