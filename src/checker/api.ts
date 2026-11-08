/*
 * The checking service owns uploaded invoices, extracted fields and check results.
 */
"use client";

import { useEffect, useState } from "react";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import type { Outcome, SupplierInvoice } from "./types";
import { broadcastServiceChange, listenForServiceChanges } from "@/lib/service-sync";
import { resolveServiceUrl } from "./service-url";
import { createReadLoop } from "@/lib/read-loop";
import { MAX_UPLOAD_BATCH_FILES } from "./upload-formats";
import { retryAfterSeconds, serviceReadFailure } from "@/lib/service-error";

export const SERVICE_URL = resolveServiceUrl(
  process.env.NEXT_PUBLIC_INVOICE_API ?? "http://127.0.0.1:8001",
  typeof window === "undefined" ? undefined : window.location?.hostname,
);
export const SESSION_ID_KEY = "ic.session.id.v1";

let activeSessionId: string | null = null;

function clearLegacyBrowserStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of ["ic.session.v1", "ic.session.v2", SESSION_ID_KEY]) {
    try {
      window.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      window.sessionStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Return the active in-memory session token/ID when set, or null when using HttpOnly cookie auth.
 */
export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function setActiveSessionId(sessionId: string | null): void {
  clearLegacyBrowserStorage();
  activeSessionId = sessionId ? sessionId.trim() || null : null;
  cache = null;
  reloadInvoices();
}

export function sessionHeaders(extra?: Record<string, string>, mutation = false): Record<string, string> | undefined {
  const sid = getActiveSessionId();
  if (!sid && !extra && !mutation) return undefined;
  return {
    ...(extra ?? {}),
    ...(mutation ? { "X-Requested-With": "InvoiceChecker" } : {}),
    ...(sid ? { "X-Invoice-Session": sid } : {}),
  };
}

const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

const unreachable = "The checking service could not be reached.";
const broken = "The checking service had a problem. Try again in a moment.";

/** The service's own limit. It is 20 MiB; the page says 20 MB. */
const MAX_BYTES = 20 * 1024 * 1024;
/** The most rows the service gives in one answer. */
const PAGE = 100;
/** Bound each read; batch uploads have a separate deadline for receiving a receipt. */
const READ_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** How often a page looks again while an invoice is still being checked. */
const RECHECK_MS = 5_000;

/** Keep the polling budget bounded as the workspace history grows. */
export const invoicePollInterval = (count: number) => Math.max(RECHECK_MS, Math.ceil(count / PAGE) * 2_000);

async function read(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    const headers = sessionHeaders();
    return await fetch(`${SERVICE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...(headers ? { headers } : {}),
      signal: AbortSignal.any([AbortSignal.timeout(READ_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });
  } catch {
    throw new Error(unreachable);
  }
}

export async function listInvoices(signal?: AbortSignal): Promise<SupplierInvoice[]> {
  const previousList = cache;
  const previousById = new Map(previousList?.map(invoice => [invoice.id, invoice]));
  const includeDetails = previousList === null;
  const unchanged = (row: Partial<ServiceInvoice> & { id: string }) =>
    !!row.updated_at && previousById.get(row.id)?.serverUpdatedAt === row.updated_at;
  const inProgress = (status?: string) => !!status && ["queued", "reading", "extracting", "checking"].includes(status);
  const summaries: (Partial<ServiceInvoice> & { id: string })[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await read(`/invoices?include_details=${includeDetails}&limit=${PAGE}&offset=${offset}`, signal);
    if (!response.ok) throw serviceReadFailure(response, broken);
    let rows = await response.json() as (Partial<ServiceInvoice> & { id: string })[];
    // Fetch changed results by page: a completed batch must not create one
    // authenticated request per invoice on every refresh.
    if (!includeDetails && rows.some(row => !unchanged(row) && !inProgress(row.status) && !Object.hasOwn(row, "invoice"))) {
      const details = await read(`/invoices?include_details=true&limit=${PAGE}&offset=${offset}`, signal);
      if (!details.ok) throw serviceReadFailure(details, broken);
      rows = await details.json() as ServiceInvoice[];
    }
    summaries.push(...rows);
    if (rows.length < PAGE) break;
  }
  const found: SupplierInvoice[] = new Array(summaries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, summaries.length) }, async () => {
    while (next < summaries.length) {
      const index = next++;
      const summary = summaries[index];
      const previous = previousById.get(summary.id);
      if (previous && unchanged(summary)) found[index] = previous;
      else if (Object.hasOwn(summary, "invoice") && Object.hasOwn(summary, "check")) found[index] = toSupplierInvoice(summary as ServiceInvoice);
      else if (inProgress(summary.status)) found[index] = toSupplierInvoice({ ...summary, invoice: null, check: null, document: null } as ServiceInvoice);
      else found[index] = await getInvoice(summary.id, signal);
    }
  }));
  return previousList?.length === found.length && found.every((invoice, index) => invoice === previousList[index]) ? previousList : found;
}

export async function getInvoice(id: string, signal?: AbortSignal): Promise<SupplierInvoice> {
  if (!isServiceId(id)) throw new Error("No invoice with this link. It may have been removed.");
  const response = await read(`/invoices/${id}`, signal);
  if (response.status === 404) throw new Error("No invoice with this link. It may have been removed.");
  if (!response.ok) throw serviceReadFailure(response, broken);
  return toSupplierInvoice((await response.json()) as ServiceInvoice);
}

/** One sentence for a file that must not be sent at all. Null means it may be sent. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!/\.(pdf|xml)$/i.test(file.name)) return "Only PDF or Vietnamese HDon XML invoices can be checked.";
  if (file.size > MAX_BYTES) return "That invoice is over the 20 MB limit.";
  return null;
}

/**
 * One plain sentence for an upload the service refused. Null means the upload was saved.
 * When the service gives its own reason for refusing the file, that sentence is shown.
 */
export function uploadFailure(status: number, detail?: unknown): string | null {
  if (status === 201) return null;
  if (status === 429) return "Another invoice is being checked. Try again in a moment.";
  if (status === 503) return "The checking service is not ready.";
  if (status === 413) return "That invoice is over the 20 MB limit.";
  if (status === 422 || status === 415 || status === 400) {
    return typeof detail === "string" && detail ? `This file could not be checked. ${detail}` : "This invoice could not be checked.";
  }
  return broken;
}

/** An upload the service refused. Carries the status so the screen can say why, and wait on 429. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string | null = null,
    readonly retryAfter: number | null = null,
    readonly batchLimit: number | null = null,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Send one PDF or XML invoice. A 201 is the checked invoice. A 422 that carries a saved record is an invoice
 * the service kept but could not check; it is returned too, so its page can say why.
 */
export async function uploadInvoice(file: File, projectId?: string): Promise<SupplierInvoice> {
  const body = new FormData();
  body.append("file", file);
  const headers = sessionHeaders(undefined, true);
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`, {
      method: "POST",
      body,
      credentials: "include",
      ...(headers ? { headers } : {}),
    });
  } catch {
    throw new UploadError(unreachable, null);
  }
  const answer = (await response.json().catch(() => null)) as (Partial<ServiceInvoice> & { detail?: unknown }) | null;
  if (response.status === 201 || (response.status === 422 && typeof answer?.id === "string")) {
    return toSupplierInvoice(answer as ServiceInvoice);
  }
  const retry = Number(response.headers.get("Retry-After"));
  throw new UploadError(
    uploadFailure(response.status, answer?.detail) ?? broken,
    response.status,
    typeof answer?.detail === "string" ? answer.detail : null,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}

/** Where the service keeps the PDF exactly as it was uploaded. */
export const invoiceFileUrl = (id: string) => {
  const sid = getActiveSessionId();
  const base = `${SERVICE_URL}/invoices/${id}/file`;
  return sid ? `${base}?session_id=${encodeURIComponent(sid)}` : base;
};

/**
 * Send a failed invoice's own PDF through the check again. The service keeps the first attempt,
 * so this saves a new invoice; the list sets the failed attempt aside once a newer one exists.
 */
export async function retryInvoice(inv: SupplierInvoice): Promise<SupplierInvoice> {
  const response = await read(`/invoices/${inv.id}/file`);
  if (response.status === 404) throw new Error("The original PDF is no longer kept, so it cannot be checked again. Upload it again.");
  if (!response.ok) throw new Error(broken);
  const file = new File([await response.blob()], inv.fileName, { type: /\.xml$/i.test(inv.fileName) ? "application/xml" : "application/pdf" });
  return uploadInvoice(file, inv.projectId ?? undefined);
}

/** Re-run the stored source in place; the invoice ID and project remain unchanged. */
export async function reprocessInvoice(inv: SupplierInvoice): Promise<SupplierInvoice> {
  const response = await fetch(`${SERVICE_URL}/invoices/${inv.id}/reprocess`, {
    method: "POST", credentials: "include", headers: sessionHeaders(undefined, true),
  });
  const answer = await response.json().catch(() => null);
  if (response.ok || (response.status === 422 && answer?.id === inv.id)) {
    return toSupplierInvoice(answer as ServiceInvoice);
  }
  throw new Error(typeof answer?.detail === "string" ? answer.detail : broken);
}

/** One plain sentence for a decision the service refused. */
export function decisionFailure(status: number, detail?: unknown): string {
  if (status === 404 && detail === "Invoice not found") return "No invoice with this link. It may have been removed.";
  // A service from before outcomes has no such route: FastAPI answers its own "Not Found".
  if (status === 404 || status === 405) return "The checking service cannot save decisions yet.";
  if ((status === 409 || status === 422) && typeof detail === "string" && detail) return `${detail}.`;
  return broken;
}

/**
 * Save the clerk's decision on one invoice, or clear it with null (Undo). The service holds the
 * same rules as the screens and answers the saved invoice.
 */
export async function decideInvoice(id: string, outcome: Outcome | null, reason: string | null = null): Promise<SupplierInvoice> {
  if (!isServiceId(id)) throw new Error("No invoice with this link. It may have been removed.");
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices/${id}/outcome`, {
      method: "PUT",
      credentials: "include",
      headers: sessionHeaders({ "Content-Type": "application/json" }, true),
      body: JSON.stringify({ outcome, reason }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch {
    throw new Error(unreachable);
  }
  const answer = (await response.json().catch(() => null)) as (ServiceInvoice & { detail?: unknown }) | null;
  if (response.ok && answer && typeof answer.id === "string") return toSupplierInvoice(answer);
  throw new Error(decisionFailure(response.status, answer?.detail));
}

let cache: SupplierInvoice[] | null = null;
let cacheRevision = 0;
const SYNC_KEY = `ic.invoices.changed:${SERVICE_URL}`;
/** Each open list. Null asks it to load again; a list is the new answer to show. */
const listeners = new Set<(list: SupplierInvoice[] | null) => void>();

/** Current saved records, including receipts/reloads received after a selection was made. */
export function cachedInvoices(): SupplierInvoice[] | null { return cache; }

/** Ask every open list to load again. Used after an upload. */
export function reloadInvoices(): void {
  ++cacheRevision;
  for (const listener of listeners) listener(null);
}

/** Put one invoice the service just answered into every open list, without loading them all again. */
export function rememberInvoice(saved: SupplierInvoice): void {
  rememberInvoices([saved]);
}

/** Publish one complete receipt once, including one change notification to sibling tabs. */
export function rememberInvoices(saved: SupplierInvoice[]): void {
  if (!saved.length) return;
  ++cacheRevision;
  const updates = new Map(saved.map(invoice => [invoice.id, invoice]));
  const existing = new Set(cache?.map(invoice => invoice.id));
  cache = [...saved.filter(invoice => !existing.has(invoice.id)).reverse(), ...(cache ?? []).map(invoice => updates.get(invoice.id) ?? invoice)];
  for (const listener of listeners) listener(cache);
  broadcastServiceChange(SYNC_KEY, saved.at(-1)!.id);
}

/** Every saved invoice, including failed processing attempts. */
export function useInvoices(): { invoices: SupplierInvoice[] | null; error: string | null } {
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const loop = createReadLoop({
      read: async (signal) => {
        const revision = cacheRevision;
        return { revision, list: await listInvoices(signal) };
      },
      success: ({ revision, list }) => {
        if (revision !== cacheRevision) { loop.refresh(true); return; }
        cache = list;
        setInvoices(list);
        setError(null);
      },
      failure: (reason) => setError(reason instanceof Error ? reason.message : unreachable),
      shouldPoll: () => !!cache?.some(invoice => invoice.state === "checking"),
      interval: () => invoicePollInterval(cache?.length ?? 0),
    });
    const listener = (list: SupplierInvoice[] | null) => {
      setInvoices(list ?? cache);
      setError(null);
      loop.refresh(true);
    };
    listeners.add(listener);
    const stopSync = listenForServiceChanges(SYNC_KEY, reloadInvoices, () => loop.refresh());
    loop.refresh();
    return () => {
      loop.stop();
      listeners.delete(listener);
      stopSync();
    };
  }, []);
  return { invoices, error };
}

/**
 * The service's copy of one invoice.
 * While a service invoice is still being checked, it is read again every few seconds.
 */
export function useRemoteInvoice(id: string): {
  invoice: SupplierInvoice | null;
  error: string | null;
  loading: boolean;
  replace: (saved: SupplierInvoice) => void;
} {
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      getInvoice(id).then(
        (found) => {
          if (!live) return;
          setInvoice(found);
          setError(null);
          setLoading(false);
          if (found.state === "checking") timer = setTimeout(load, RECHECK_MS);
        },
        (reason: unknown) => {
          if (!live) return;
          setInvoice(null);
          setError(reason instanceof Error ? reason.message : unreachable);
          setLoading(false);
        },
      );
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);
  return { invoice, error, loading, replace: setInvoice };
}

export interface BatchReceipt {
  id: string;
  invoices: SupplierInvoice[];
  duplicates: { filename: string; existing_id: string | null }[];
}

/** Advisory, cheap capacity check before hashing or decoding a large batch. */
export async function batchCapacity(projectId?: string, signal?: AbortSignal): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoice-batches${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`, {
      method: "HEAD", cache: "no-store", credentials: "include", headers: sessionHeaders(),
      signal: AbortSignal.any([AbortSignal.timeout(READ_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });
  } catch { throw new UploadError("The checking service could not be reached.", null); }
  if (response.status === 405 || response.status === 404) return MAX_UPLOAD_BATCH_FILES;
  if (!response.ok) throw new UploadError("Upload capacity could not be checked. Try again shortly.", response.status, null, retryAfterSeconds(response));
  const raw = response.headers.get("X-Invoice-Batch-Limit");
  // An older deployed backend may not expose this optional header yet.
  if (raw === null) return MAX_UPLOAD_BATCH_FILES;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0) throw new UploadError("The capacity response could not be read.", null);
  if (!limit) throw new UploadError("The invoice queue is full. Waiting files will retry shortly.", 503, null, retryAfterSeconds(response) ?? 30, 0);
  return Math.min(MAX_UPLOAD_BATCH_FILES, limit);
}

/** Accept the complete batch before any browser-independent checking is promised. */
export async function uploadInvoiceBatch(files: File[], projectId?: string, signal?: AbortSignal): Promise<BatchReceipt> {
  if (files.length > MAX_UPLOAD_BATCH_FILES) {
    throw new UploadError("Upload at most 500 invoices per batch. Queue additional batches.", 413);
  }
  const body = new FormData();
  for (const file of files) body.append("files", file);
  let response: Response;
  let result;
  try {
    response = await fetch(`${SERVICE_URL}/invoice-batches${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`, {
      method: "POST", body, credentials: "include", headers: sessionHeaders({ "X-Invoice-Batch-Count": String(files.length) }, true),
      signal: AbortSignal.any([AbortSignal.timeout(UPLOAD_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });
    try { result = await response.json(); }
    catch (error) { if (error instanceof SyntaxError) result = null; else throw error; }
  } catch { throw new UploadError("The batch could not be uploaded. Keep this page open and try again.", null); }
  if (response.ok && (!result || !Array.isArray(result.invoices))) {
    throw new UploadError("The upload receipt could not be read. The batch may already have been saved. Keep this page open while uploads retry.", null);
  }
  if (!response.ok || !result || !Array.isArray(result.invoices)) {
    const fallback = [502, 504].includes(response.status)
      ? "The upload connection timed out or the checking service is unavailable. Refresh the invoice list before retrying; the batch may already have been saved. If invoices are missing, upload a smaller batch."
      : response.status === 413
        ? "The upload was too large for the server. Split the archive into smaller batches."
        : `The batch could not be accepted (HTTP ${response.status}). Try again.`;
    const detail = typeof result?.detail === "string" ? result.detail : fallback;
    const limit = response.headers.get("X-Invoice-Batch-Limit");
    const batchLimit = limit !== null && Number.isInteger(Number(limit)) && Number(limit) >= 0 ? Number(limit) : null;
    throw new UploadError(detail, response.status, detail, retryAfterSeconds(response), batchLimit);
  }
  return { id: result.id, invoices: (result.invoices as ServiceInvoice[]).map(toSupplierInvoice), duplicates: result.duplicates ?? [] };
}
