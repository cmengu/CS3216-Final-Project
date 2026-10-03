/*
 * Add orders on the demo store, as the prototype's stageFiles(), addSample(), processFiles(),
 * retryFailed(), startOver(), pick(), setQty(), confirmAll(), parsePaste() and addFromMail().
 * The queue's display entries, the notice and the drafts (with their rows) live in the store
 * and survive a reload. Only the files' bytes are kept in memory: a File cannot be stored.
 *
 * The `*Op` functions change a draft of the state and are pure, so they are unit-tested; the
 * rest drive them through the store.
 */
import {
  addDrafts,
  buildPayload,
  cellsToFill,
  draftsFrom,
  dupNotice,
  duplicateDetail,
  pickCustomerIn,
  pickSkuIn,
  proposeAlias,
  readDetail,
  setCellIn,
  setQtyIn,
  splitByName,
  type ReadInput,
} from "@/lib/add-orders";
import { nowStr, ref } from "@/lib/format";
import {
  contentHash,
  enqueueFiles,
  fileFingerprint,
  processEgcQueue,
  readPaste,
  readPdf,
  toRows,
  validate,
  validatePdfFile,
  type EgcPdfResult,
} from "@/lib/importer";
import { SAMPLE_NAMES, sampleFiles } from "@/lib/samples";
import { submitConfirm } from "@/platform/confirm";
import { PRODUCTS } from "@/sample";
import type { DemoState, MailItem, QueueEntry } from "@/sample";
import { buildLists } from "@/sample/lists";
import { getState, update } from "@/state/demo-store";

/** The lists to map against: the app's products and customers, and the aliases approved so far. */
export const listsOf = (s: Pick<DemoState, "customers" | "aliases">) => buildLists(PRODUCTS, s.customers, s.aliases);

/* ------------------------------------------------------------- pure ops ---- */

/** A read PO becomes draft orders, and its queue entry says what was read (or why it was skipped). */
export function settleOp(s: DemoState, id: string, result: EgcPdfResult | null, at: string) {
  const f = s.queue.find((x) => x.id === id);
  if (!f) return;
  const set = (st: QueueEntry["st"], detail: string) => Object.assign(f, { st, detail });
  if (!result) return set("failed", "Could not read this file");
  if (result.status !== "parsed" && result.status !== "partial") return set(result.status, result.detail);
  const dup = duplicateDetail(result.fingerprints, s.orders, s.events);
  if (dup) return set("duplicate", dup);
  const rows = toRows([{ sourceId: id, order: result.order }], listsOf(s));
  const toFill = cellsToFill(validate(rows).blockers);
  const descs = rows.map((r) => result.order.lines.find((l) => l.lineNumber === r.source.lineNumber)?.description ?? r.cells.sku.sourceText ?? "");
  const made = draftsFrom(
    { sourceId: id, fileName: f.name, size: f.size, at, readerId: result.readerId, readerLabel: result.readerLabel, source: result.order.source, fingerprints: result.fingerprints, rows, descs },
    s,
  );
  s.orders.push(...made.orders);
  s.seq = made.seq;
  set(result.status === "partial" || toFill ? "partial" : "parsed", readDetail(result.readerLabel, rows.length, toFill));
}

/** A pasted WhatsApp order, read by the importer for the chosen customer and date, becomes a draft. */
export function pasteOp(s: DemoState, input: Omit<ReadInput, "readerLabel" | "fileName">) {
  const made = draftsFrom({ ...input, fileName: "WhatsApp paste", readerLabel: "WhatsApp" }, s);
  s.orders.push(...made.orders);
  s.seq = made.seq;
}

const draftOf = (s: DemoState, id: string) => {
  const o = s.orders.find((x) => x.id === id);
  if (!o || !o.read) throw new Error(`No draft ${id}`);
  return o;
};

/** The prototype's pick(): the line gets the SKU, and its wording is proposed as an alias. Returns the toast. */
export function pickOp(s: DemoState, orderId: string, rowId: string, sku: string): string {
  if (!sku) return "";
  const o = draftOf(s, orderId);
  const i = o.read!.rows.findIndex((r) => r.id === rowId);
  const desc = o.lines[i]?.desc ?? "";
  pickSkuIn(o, rowId, sku, listsOf(s), s.customers);
  s.aliases = proposeAlias(s.aliases, desc, sku, ref(o));
  return `“${desc}” → ${sku} · alias proposed`;
}

/** The prototype's setQty(). */
export const setQtyOp = (s: DemoState, orderId: string, rowId: string, typed: string) => setQtyIn(draftOf(s, orderId), rowId, typed, s.customers);

/** A typed Order Date or PO Number the PO did not give. */
export const setCellOp = (s: DemoState, orderId: string, rowId: string, column: "orderDate" | "poNumber", value: string) =>
  setCellIn(draftOf(s, orderId), rowId, column, value, s.customers);

/** The customer for a draft whose buyer was not in the customer list. */
export const pickCustomerOp = (s: DemoState, orderId: string, customerId: string) => pickCustomerIn(draftOf(s, orderId), customerId, listsOf(s), s.customers);

/** The prototype's startOver(): the queue empties and the drafts that came from Add orders go. */
export function startOverOp(s: DemoState) {
  s.queue = [];
  s.notice = "";
  s.orders = s.orders.filter((o) => !(o.state === "draft" && o.fromAdd));
}

/* -------------------------------------------------------------- the files ---- */

/** The queued files' bytes, by entry id. Gone on reload; the store's entries say so (afterReload). */
const bytes = new Map<string, File>();
/** Increases on every Start over, so results of an abandoned run never land. */
let run = 0;
let abort: AbortController | null = null;

const patch = (id: string, p: Partial<QueueEntry>) =>
  update((d) => {
    const f = d.queue.find((x) => x.id === id);
    if (f) Object.assign(f, p);
  });

async function check(ids: string[]) {
  const mine = run;
  for (const id of ids) {
    const file = bytes.get(id);
    if (!file) continue;
    const { status, detail } = await validatePdfFile(file);
    if (mine !== run) return;
    patch(id, { st: status, detail });
  }
}

/** Step 1: chosen, dropped, pasted, sample or mailbox files join the queue; a name already queued is skipped. */
export function stageFiles(files: readonly File[]) {
  const { fresh, dup } = splitByName(getState().queue, files);
  const { added } = enqueueFiles([], fresh);
  added.forEach((q) => bytes.set(q.id, q.file));
  update((d) => {
    d.queue.push(...added.map((q): QueueEntry => ({ id: q.id, name: q.file.name, size: q.file.size, st: "validating", detail: q.detail })));
    d.notice = dupNotice(dup);
  });
  return check(added.map((q) => q.id));
}

/** "use the four sample POs": the sample set, once (the prototype's addSample does nothing while one is queued). */
export async function addSample(): Promise<boolean> {
  if (getState().queue.some((f) => SAMPLE_NAMES.includes(f.name))) return true;
  const files = await sampleFiles();
  if (!files.length) return false;
  await stageFiles(files);
  return true;
}

/** The prototype's addFromMail(): the mailbox's PDFs join the queue and the mailbox empties. */
export async function addFromMail(mail: readonly MailItem[]): Promise<boolean> {
  const files = await sampleFiles(mail.filter((m) => !getState().queue.some((f) => f.name === m.file)).map((m) => m.file));
  if (!files.length) return false;
  update((d) => {
    d.mailbox = [];
    d.src = "pdf";
  });
  await stageFiles(files);
  return true;
}

/** Step 2: read every queued PDF in the browser, one after another, updating each file as it finishes. */
export async function processFiles() {
  const ready = getState().queue.filter((f) => f.st === "ready" && bytes.has(f.id));
  if (!ready.length) return;
  const mine = run;
  abort = new AbortController();
  const ids = new Set(ready.map((f) => f.id));
  update((d) => d.queue.forEach((f) => ids.has(f.id) && Object.assign(f, { st: "processing", detail: "" })));
  await processEgcQueue(
    ready.map((f) => {
      const file = bytes.get(f.id)!;
      return { id: f.id, file, fingerprint: fileFingerprint(file), status: "ready" as const, detail: f.detail };
    }),
    {
      readFn: readPdf,
      concurrency: 1,
      signal: abort.signal,
      onFileDone: (item, result) => {
        if (mine !== run) return;
        bytes.delete(item.id);
        update((d) => settleOp(d, item.id, result, nowStr()));
      },
    },
  );
}

/** Retry: failed and unsupported files are checked again. A file whose bytes did not survive a reload stays as it is. */
export function retryFailed() {
  const ids = getState()
    .queue.filter((f) => (f.st === "failed" || f.st === "unsupported") && bytes.has(f.id))
    .map((f) => f.id);
  update((d) => d.queue.forEach((f) => ids.includes(f.id) && Object.assign(f, { st: "validating", detail: "Checking file…" })));
  return check(ids);
}

export function removeFile(id: string) {
  bytes.delete(id);
  update((d) => void (d.queue = d.queue.filter((f) => f.id !== id)));
}

export function clearQueue() {
  bytes.clear();
  update((d) => {
    d.queue = [];
    d.notice = "";
  });
}

export function startOver() {
  run++;
  abort?.abort();
  abort = null;
  bytes.clear();
  update(startOverOp);
}

/* ------------------------------------------------------------- the table ---- */

export function pick(orderId: string, rowId: string, sku: string): string {
  let out = "";
  update((d) => void (out = pickOp(d, orderId, rowId, sku)));
  return out;
}
export const setQty = (orderId: string, rowId: string, typed: string) => update((d) => setQtyOp(d, orderId, rowId, typed));
export const setCell = (orderId: string, rowId: string, column: "orderDate" | "poNumber", value: string) =>
  update((d) => setCellOp(d, orderId, rowId, column, value));
export const pickCustomer = (orderId: string, customerId: string) => update((d) => pickCustomerOp(d, orderId, customerId));

/** The prototype's confirmAll(): every draft from Add orders is confirmed and the queue empties. Returns how many. */
export async function confirmAll(): Promise<number> {
  const drafts = addDrafts(getState().orders);
  const n = await submitConfirm(await buildPayload(drafts), drafts.map((o) => o.id));
  bytes.clear();
  update((d) => {
    d.queue = [];
    d.notice = "";
  });
  return n;
}

/**
 * WhatsApp: the importer reads the pasted message for the chosen customer and delivery date,
 * and it becomes a draft in the same table. Returns how many lines were read and how many were
 * kept as notes.
 */
export async function addPaste(text: string, customerId: string, name: string, deliveryDate: string) {
  const { order, unparsed } = readPaste(text, { customerId, name }, deliveryDate);
  if (!order.lines.length) return { lines: 0, unparsed: unparsed.length };
  const sourceId = "wa-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const fingerprints = { fileHash: null, contentHash: await contentHash(text) };
  update((d) => {
    const rows = toRows([{ sourceId, order }], listsOf(d));
    const descs = rows.map((r) => order.lines.find((l) => l.lineNumber === r.source.lineNumber)?.description ?? "");
    pasteOp(d, { sourceId, size: text.length, at: nowStr(), readerId: "whatsapp-paste", source: order.source, fingerprints, rows, descs, unparsed, date: deliveryDate });
  });
  return { lines: order.lines.length, unparsed: unparsed.length };
}
