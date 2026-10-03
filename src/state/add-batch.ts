/*
 * The Add orders batch: the queued files, the orders the importer read from them and the rows
 * under review. It lives in memory only (a File cannot be stored), survives moving between
 * pages, and is gone on reload. Nothing here leaves the browser.
 */
"use client";

import { useSyncExternalStore } from "react";
import {
  cellsToFill,
  dupNotice,
  duplicateDetail,
  keepManual,
  readDetail,
  splitByName,
  type AddStatus,
  type ReadOrder,
} from "@/lib/add-orders";
import {
  contentHash,
  enqueueFiles,
  fileFingerprint,
  processEgcQueue,
  readerLabel,
  readPaste,
  readPdf,
  toRows,
  validate,
  validatePdfFile,
  type EgcOutputRow,
  type EgcPdfResult,
  type EgcQueuedFile,
} from "@/lib/importer";
import { PRODUCTS } from "@/sample";
import { buildLists } from "@/sample/lists";
import { getState } from "@/state/demo-store";

export interface AddFile {
  id: string;
  file: File;
  name: string;
  size: number;
  st: AddStatus;
  detail: string;
}

export interface AddBatch {
  files: AddFile[];
  reads: ReadOrder[];
  rows: EgcOutputRow[];
  notice: string;
}

const EMPTY: AddBatch = { files: [], reads: [], rows: [], notice: "" };
let batch: AddBatch = EMPTY;
/** Increases on every Start over, so results of an abandoned run never land. */
let run = 0;
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

const get = () => batch;
function set(next: AddBatch) {
  batch = next;
  listeners.forEach((l) => l());
}
const patchFile = (id: string, p: Partial<AddFile>) => set({ ...batch, files: batch.files.map((f) => (f.id === id ? { ...f, ...p } : f)) });

/** The lists to map against: the app's products and customers, and the aliases approved so far. */
export function currentLists() {
  const s = getState();
  return buildLists(PRODUCTS, s.customers, s.aliases);
}

export function useAddBatch(): AddBatch {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    get,
    () => EMPTY,
  );
}

async function check(ids: string[]) {
  const mine = run;
  for (const id of ids) {
    const f = batch.files.find((x) => x.id === id);
    if (!f) continue;
    const { status, detail } = await validatePdfFile(f.file);
    if (mine !== run) return;
    patchFile(id, { st: status, detail });
  }
}

/** Step 1: chosen, dropped, pasted or sample files join the queue; a name already queued is skipped. */
export function stageFiles(files: readonly File[]) {
  const { fresh, dup } = splitByName(batch.files, files);
  const { added } = enqueueFiles(batch.files.map(asQueued), fresh);
  const more: AddFile[] = added.map((q) => ({ id: q.id, file: q.file, name: q.file.name, size: q.file.size, st: "validating", detail: q.detail }));
  set({ ...batch, files: [...batch.files, ...more], notice: dupNotice(dup) });
  return check(more.map((f) => f.id));
}

function asQueued(f: AddFile): EgcQueuedFile {
  return { id: f.id, file: f.file, fingerprint: fileFingerprint(f.file), status: "ready", detail: f.detail };
}

function settle(id: string, result: EgcPdfResult | null) {
  const f = batch.files.find((x) => x.id === id);
  if (!f) return;
  if (!result) return patchFile(id, { st: "failed", detail: "Could not read this file" });
  if (result.status !== "parsed" && result.status !== "partial") return patchFile(id, { st: result.status, detail: result.detail });
  const s = getState();
  const dup = duplicateDetail(result.fingerprints.contentHash, batch.reads, s.orders, s.events);
  if (dup) return patchFile(id, { st: "duplicate", detail: dup });
  const rows = toRows([{ sourceId: id, order: result.order }], currentLists());
  const toFill = cellsToFill(validate(rows).blockers);
  const read: ReadOrder = { fileId: id, fileName: f.name, size: f.size, readerId: result.readerId, fingerprints: result.fingerprints, order: result.order };
  set({
    ...batch,
    reads: [...batch.reads, read],
    rows: [...batch.rows, ...rows],
    files: batch.files.map((x) =>
      x.id === id ? { ...x, st: result.status === "partial" || toFill ? "partial" : "parsed", detail: readDetail(readerLabel(result.readerId), rows.length, toFill) } : x,
    ),
  });
}

/** Step 2: read every queued PDF in the browser, one after another, updating each file as it finishes. */
export async function processFiles() {
  const ready = batch.files.filter((f) => f.st === "ready");
  if (!ready.length) return;
  const mine = run;
  abort = new AbortController();
  set({ ...batch, files: batch.files.map((f) => (f.st === "ready" ? { ...f, st: "processing", detail: "" } : f)) });
  await processEgcQueue(ready.map(asQueued), {
    readFn: readPdf,
    concurrency: 1,
    signal: abort.signal,
    onFileDone: (item, result) => {
      if (mine === run) settle(item.id, result);
    },
  });
}

export function retryFailed() {
  const ids = batch.files.filter((f) => f.st === "failed" || f.st === "unsupported").map((f) => f.id);
  set({ ...batch, files: batch.files.map((f) => (ids.includes(f.id) ? { ...f, st: "validating", detail: "Checking file…" } : f)) });
  return check(ids);
}

export const removeFile = (id: string) => set({ ...batch, files: batch.files.filter((f) => f.id !== id) });
export const clearQueue = () => set({ ...batch, files: [], notice: "" });

export function startOver() {
  run++;
  abort?.abort();
  abort = null;
  set(EMPTY);
}

/** Replace one row with the reviewer's change (setManualValue and friends). */
export function editRow(rowId: string, fn: (r: EgcOutputRow) => EgcOutputRow) {
  set({ ...batch, rows: batch.rows.map((r) => (r.id === rowId ? fn(r) : r)) });
}

/** The reviewer picked the customer for a PO: the importer maps its rows again for that customer. */
export function assignCustomer(sourceId: string, customerId: string) {
  const read = batch.reads.find((r) => r.fileId === sourceId);
  if (!read) return;
  const order = { ...read.order, assignedCustomerId: customerId };
  const prev = batch.rows.filter((r) => r.source.sourceId === sourceId);
  const next = keepManual(prev, toRows([{ sourceId, order }], currentLists()));
  const at = batch.rows.findIndex((r) => r.source.sourceId === sourceId);
  const rest = batch.rows.filter((r) => r.source.sourceId !== sourceId);
  set({
    ...batch,
    reads: batch.reads.map((r) => (r === read ? { ...r, order } : r)),
    rows: [...rest.slice(0, at), ...next, ...rest.slice(at)],
  });
}


/**
 * WhatsApp: the importer reads the pasted message for the chosen customer and delivery date;
 * its rows join the same table. Returns how many lines were read and how many were kept as notes.
 */
export async function addPaste(text: string, customerId: string, name: string, deliveryDate: string) {
  const { order, unparsed } = readPaste(text, { customerId, name }, deliveryDate);
  if (!order.lines.length) return { lines: 0, unparsed: unparsed.length };
  const id = "wa-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const read: ReadOrder = {
    fileId: id,
    fileName: "WhatsApp paste",
    size: text.length,
    readerId: "whatsapp-paste",
    fingerprints: { fileHash: null, contentHash: await contentHash(text) },
    order,
  };
  const rows = toRows([{ sourceId: id, order }], currentLists());
  set({ ...batch, reads: [...batch.reads, read], rows: [...batch.rows, ...rows] });
  return { lines: order.lines.length, unparsed: unparsed.length };
}
