/*
 * Unpack ZIP/RAR archives locally, then upload complete batches to their projects.
 * Duplicate invoices are skipped by SHA-256 within each project.
 */
"use client";

import { useSyncExternalStore } from "react";
import { batchCapacity, cachedInvoices, rememberInvoices, reloadInvoices, uploadInvoiceBatch, UploadError } from "./api";
import type { SupplierInvoice } from "./types";
import type { ArchiveEntry, InvoiceArchive } from "./archives";

import { isArchive, MAX_ARCHIVE_BYTES, MAX_INVOICE_BYTES, MAX_UPLOAD_BATCH_BYTES, MAX_SELECTION_FILES, MAX_UPLOAD_BATCH_FILES } from "./upload-formats";

export interface QueueItem {
  projectId?: string;
  key: string;
  name: string;
  status: "waiting" | "unpacking" | "uploading";
}

export interface UploadNotice {
  key: string;
  kind: "error" | "duplicate" | "skipped" | "queued";
  text: string;
  /** For a duplicate: the invoice already uploaded. */
  invoiceId?: string;
  retryUpload?: boolean;
}

interface State {
  items: QueueItem[];
  notices: UploadNotice[];
  /** The last invoice the queue finished, so a screen can select it. */
  lastDone: SupplierInvoice | null;
  /** How many uploads finished since the page opened. */
  doneCount: number;
}

let state: State = { items: [], notices: [], lastDone: null, doneCount: 0 };
const files = new Map<string, File>();
const archiveFiles = new Map<string, { archive: InvoiceArchive; entry: ArchiveEntry }>();
const archives = new Map<InvoiceArchive, number>();
const fingerprints = new Map<string, string | null>();
const listeners = new Set<() => void>();
let seq = 0;
let session = 0;
let running: number | null = null;
let unpacking: AbortController | null = null;
let uploading: AbortController | null = null;
let batchSize = MAX_UPLOAD_BATCH_FILES;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryFailures = 0;
let quickCapacityRetries = 0;
let retryNoticeKey: string | null = null;
let paused = false;
let latestKnown: () => SupplierInvoice[] = () => [];
/** Fingerprints uploaded in this session, so a second copy in the same batch is caught too. */
const sent = new Map<string, SupplierInvoice>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Clear upload queue notices and duplicate cache when switching user sessions. */
export function resetUploadsSession() {
  ++session;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retryFailures = 0;
  quickCapacityRetries = 0;
  retryNoticeKey = null;
  paused = false;
  latestKnown = () => [];
  unpacking?.abort();
  unpacking = null;
  uploading?.abort();
  uploading = null;
  batchSize = MAX_UPLOAD_BATCH_FILES;
  sent.clear();
  for (const archive of archives.keys()) archive.close();
  archives.clear();
  archiveFiles.clear();
  fingerprints.clear();
  files.clear();
  set({ items: [], notices: [], lastDone: null, doneCount: 0 });
}

function notice(n: Omit<UploadNotice, "key">) {
  const key = `n${++seq}`;
  set({ notices: [...state.notices, { ...n, key }] });
  return key;
}

export function dismissNotice(key: string) {
  set({ notices: state.notices.filter((n) => n.key !== key) });
}

/** A permanent rejection needs an explicit user retry rather than a tight loop. */
export function resumeUploads() {
  if (!paused) return;
  paused = false;
  if (retryNoticeKey) dismissNotice(retryNoticeKey);
  retryNoticeKey = null;
  void run();
}

/** One sentence for a file refused before it is sent. Null means it may be sent. */
export function precheck(file: { name: string; size: number }): string | null {
  if (!/\.(pdf|xml|zip|rar)$/i.test(file.name)) return `${file.name} isn't a PDF, XML, ZIP or RAR file.`;
  const archive = isArchive(file.name);
  if (file.size > (archive ? MAX_ARCHIVE_BYTES : MAX_INVOICE_BYTES)) return `${file.name} is over ${archive ? 50 : 20} MB.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

/** One sentence for an upload the service refused. */
export function refusal(name: string, e: unknown): string {
  if (!(e instanceof UploadError)) return `${name} couldn't be uploaded.`;
  if (e.status === null) return "The checking service couldn't be reached.";
  if (e.status === 415) return `${name} isn't a supported PDF or XML invoice.`;
  if (e.status === 413) return `${name} is over 20 MB.`;
  if (e.status === 422 && /page/i.test(e.detail ?? "")) return `${name} must have 1 to 30 pages.`;
  if (e.status === 422 && /\.xml$/i.test(name) && e.detail) return `${name}: ${e.detail}`;
  if (e.status === 422 || e.status === 400) return `${name} couldn't be read.`;
  if (e.status === 409 || e.status === 404) return e.detail ?? e.message;
  if (e.status === 503) return "The checking service isn't ready.";
  return `${name} couldn't be uploaded.`;
}

async function sha256(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // no crypto.subtle (not a secure page): send it; the service keeps both
  }
}

const shortDate = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function releaseFile(key: string) {
  files.delete(key);
  fingerprints.delete(key);
  const source = archiveFiles.get(key);
  if (!source) return;
  archiveFiles.delete(key);
  const left = (archives.get(source.archive) ?? 1) - 1;
  if (left) archives.set(source.archive, left);
  else { source.archive.close(); archives.delete(source.archive); }
}

function deferUpload(error: unknown, keys: Set<string>, currentSession: number, sentCount: number) {
  const smaller = error instanceof UploadError && [429, 503].includes(error.status ?? 0) && error.batchLimit !== null && error.batchLimit > 0 && error.batchLimit < sentCount;
  if (smaller && error.status === 429) batchSize = Math.min(batchSize, error.batchLimit!);
  if (error instanceof UploadError && (error.status === null || [408, 429, 500, 502, 503, 504].includes(error.status))) {
    const immediate = smaller && (error.status === 429 || quickCapacityRetries++ === 0);
    const backoff = Math.min(60, 5 * 2 ** Math.min(retryFailures++, 4));
    const delay = immediate ? 0 : Math.max(5, error.retryAfter ?? 0, backoff);
    // Receipt loss can mean accepted work. Refresh once per failure streak so
    // cached fingerprints recover it before a queue-space retry.
    if (!retryNoticeKey) reloadInvoices();
    if (retryNoticeKey) dismissNotice(retryNoticeKey);
    retryNoticeKey = notice({ kind: "error", text: `${error.message} Uploads are paused and will retry automatically. Keep this page open for files still waiting to upload.` });
    set({ items: state.items.map(item => keys.has(item.key) ? { ...item, status: "waiting" } : item) });
    clearTimeout(retryTimer);
    const retryAt = Date.now() + delay * 1000 + (immediate ? 0 : Math.random() * 1_000);
    const wait = () => {
      retryTimer = setTimeout(() => {
        if (session !== currentSession) return;
        if (Date.now() < retryAt) { wait(); return; }
        retryTimer = undefined;
        void run();
      }, Math.max(0, Math.min(retryAt - Date.now(), 2_147_483_647)));
    };
    wait();
    return;
  }
  paused = true;
  if (retryNoticeKey) dismissNotice(retryNoticeKey);
  retryNoticeKey = notice({ kind: "error", text: `${error instanceof Error ? error.message : "The batch could not be uploaded."} Uploads are paused. Waiting files are kept until you retry or cancel.`, retryUpload: true });
  set({ items: state.items.map(item => keys.has(item.key) ? { ...item, status: "waiting" } : item) });
}

async function run() {
  const currentSession = session;
  if (running === currentSession) return;
  running = currentSession;
  try {
    while (session === currentSession && state.items.length) {
      const archive = isArchive(state.items[0].name) ? state.items[0] : null;
      if (archive) {
        const file = files.get(archive.key)!;
        set({ items: state.items.map(item => item.key === archive.key ? { ...item, status: "unpacking" } : item) });
        const controller = new AbortController(); unpacking = controller;
        let extracted: QueueItem[] = [];
        try {
          const { openInvoiceArchive } = await import("./archives");
          if (session !== currentSession) return;
          const result = await openInvoiceArchive(file, controller.signal);
          if (session !== currentSession) { result.close(); return; }
          if (state.items.length - 1 + result.invoices.length > MAX_SELECTION_FILES) {
            result.close();
            throw new Error("This archive would exceed 10,000 selected invoices. Other waiting files are kept.");
          }
          archives.set(result, result.invoices.length);
          extracted = result.invoices.map(entry => {
            const key = `u${++seq}`;
            archiveFiles.set(key, { archive: result, entry });
            return { key, projectId: archive.projectId, name: entry.path.replace(/\\/g, "/").split("/").pop()!, status: "waiting" };
          });
          if (result.skipped) notice({ kind: "skipped", text: `${file.name}: skipped ${result.skipped} unsupported, empty or oversized files. Nested archives are not unpacked.` });
        } catch (error) {
          if (session !== currentSession) return;
          notice({ kind: "error", text: `${file.name}: ${error instanceof Error ? error.message : "The archive could not be unpacked."}` });
        } finally { if (unpacking === controller) unpacking = null; }
        files.delete(archive.key);
        set({ items: state.items.flatMap(item => item.key === archive.key ? extracted : [item]) });
        continue;
      }
      // A lost receipt may have filled the queue. Recover already-hashed files
      // from a later list refresh before asking for free capacity again.
      const recoveredByHash = new Map((cachedInvoices() ?? latestKnown()).filter(invoice => invoice.state !== "failed").map(invoice => [`${invoice.projectId ?? ""}:${invoice.documentHash}`, invoice]));
      const recovered = state.items.filter(item => {
        const hash = fingerprints.get(item.key);
        return hash && recoveredByHash.has(`${item.projectId ?? ""}:${hash}`);
      });
      if (recovered.length) {
        const keys = new Set(recovered.map(item => item.key));
        for (const key of keys) releaseFile(key);
        set({ items: state.items.filter(item => !keys.has(item.key)) });
        if (!state.items.length && retryNoticeKey) { dismissNotice(retryNoticeKey); retryNoticeKey = null; }
        notice({ kind: "duplicate", text: `${recovered.length} invoice${recovered.length === 1 ? " was" : "s were"} already uploaded and recovered from the saved list.` });
        continue;
      }
      const projectId = state.items[0].projectId;
      const capacityController = new AbortController();
      uploading = capacityController;
      let available: number;
      try { available = await batchCapacity(projectId, capacityController.signal); }
      catch (error) {
        if (session === currentSession) deferUpload(error, new Set(), currentSession, 0);
        return;
      } finally { if (uploading === capacityController) uploading = null; }
      if (session !== currentSession) return;
      const batch: QueueItem[] = [];
      let bytes = 0;
      for (const item of state.items) {
        if (isArchive(item.name)) break;
        if (item.projectId !== projectId) continue;
        const size = files.get(item.key)?.size ?? archiveFiles.get(item.key)?.entry.size ?? 0;
        if (bytes + size > MAX_UPLOAD_BATCH_BYTES || batch.length >= Math.min(batchSize, available)) break;
        batch.push(item); bytes += size;
      }
      const selected: File[] = [];
      const hashes = new Set<string>();
      const knownInvoices = cachedInvoices() ?? latestKnown();
      const knownById = new Map(knownInvoices.map(invoice => [invoice.id, invoice]));
      const knownByHash = new Map(knownInvoices.filter(invoice => invoice.state !== "failed" && (invoice.projectId ?? undefined) === projectId).map(invoice => [invoice.documentHash, invoice]));
      let restart = false;
      for (const item of batch) {
        let file = files.get(item.key);
        if (!file) {
          const source = archiveFiles.get(item.key)!;
          try {
            file = await source.archive.extract(source.entry);
            if (session !== currentSession) return;
            files.set(item.key, file);
          } catch (error) {
            if (session !== currentSession) return;
            const refused = new Set([...archiveFiles].filter(([, value]) => value.archive === source.archive).map(([key]) => key));
            for (const key of refused) releaseFile(key);
            set({ items: state.items.filter(candidate => !refused.has(candidate.key)) });
            notice({ kind: "error", text: `${error instanceof Error ? error.message : "The archive could not be read."} Remaining files from this archive were not uploaded.` });
            restart = true;
            break;
          }
        }
        const hash = await sha256(file);
        if (session !== currentSession) return;
        fingerprints.set(item.key, hash);
        const fingerprint = `${projectId ?? ""}:${hash}`;
        const previous = sent.get(fingerprint);
        if (previous && knownById.get(previous.id)?.state === "failed") sent.delete(fingerprint);
        const duplicate = hash ? knownByHash.get(hash) ?? sent.get(fingerprint) : undefined;
        if (duplicate || (hash && hashes.has(hash))) {
          notice({ kind: "duplicate", text: duplicate ? `You already uploaded ${duplicate.number ?? duplicate.fileName} on ${shortDate(duplicate.uploadedAt)}.` : `${file.name}: duplicate content in this batch was skipped.`, invoiceId: duplicate?.id });
        } else {
          selected.push(file);
          if (hash) hashes.add(hash);
        }
      }
      if (restart) continue;
      const keys = new Set(batch.map(item => item.key));
      if (selected.length) {
        set({ items: state.items.map(item => keys.has(item.key) ? { ...item, status: "uploading" } : item) });
        const controller = new AbortController();
        uploading = controller;
        try {
          const receipt = await uploadInvoiceBatch(selected, projectId, controller.signal);
          if (session !== currentSession) return;
          retryFailures = 0;
          quickCapacityRetries = 0;
          if (retryNoticeKey) dismissNotice(retryNoticeKey);
          retryNoticeKey = null;
          for (const invoice of receipt.invoices) {
            if (invoice.documentHash) sent.set(`${projectId ?? ""}:${invoice.documentHash}`, invoice);
          }
          rememberInvoices(receipt.invoices);
          // A timed-out upload may already have committed. Its retry returns
          // duplicates, so refresh the list to recover those accepted invoices.
          if (receipt.duplicates.length) reloadInvoices();
          for (const duplicate of receipt.duplicates) notice({ kind: "duplicate", text: `${duplicate.filename} was already uploaded.`, invoiceId: duplicate.existing_id ?? undefined });
          if (receipt.invoices.length) {
            set({ lastDone: receipt.invoices.at(-1)!, doneCount: state.doneCount + receipt.invoices.length });
            const remaining = state.items.length - batch.length;
            notice({ kind: "queued", text: `Uploaded ${receipt.invoices.length} invoice${receipt.invoices.length === 1 ? "" : "s"}. ${remaining ? `${remaining} more waiting to upload. Keep this page open until all uploads finish.` : "Checking continues even if you close this page. Return later to review the results."}` });
          }
        } catch (error) {
          if (session !== currentSession) return;
          // Keep metadata for retry, but release decoded archive bytes while waiting.
          for (const key of keys) if (archiveFiles.has(key)) files.delete(key);
          deferUpload(error, keys, currentSession, selected.length);
          return;
        } finally {
          if (uploading === controller) uploading = null;
        }
      }
      if (session !== currentSession) return;
      for (const item of batch) releaseFile(item.key);
      set({ items: state.items.filter(item => !keys.has(item.key)) });
    }
  } finally { if (running === currentSession) running = null; }
}

/** Queue files for checking. `known` lists invoices already uploaded, for the duplicate check. */
export function enqueue(list: FileList | File[], known: () => SupplierInvoice[], projectId?: string) {
  const add: QueueItem[] = [];
  for (const file of Array.from(list)) {
    const problem = precheck(file);
    if (problem) {
      notice({ kind: "error", text: problem });
      continue;
    }
    const key = `u${++seq}`;
    files.set(key, file);
    add.push({ key, projectId, name: file.name, status: "waiting" });
  }
  if (!add.length) return;
  const combined = [...state.items, ...add];
  if (combined.length > MAX_SELECTION_FILES) {
    for (const item of add) files.delete(item.key);
    notice({ kind: "error", text: "Select up to 10,000 invoices at a time. Existing waiting files are kept." });
    return;
  }
  set({ items: combined });
  latestKnown = known;
  if (retryTimer || paused) return;
  void run();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const server: State = { items: [], notices: [], lastDone: null, doneCount: 0 };

export function useUploads(): State {
  return useSyncExternalStore(subscribe, () => state, () => server);
}
