/*
 * The checking service owns uploaded invoices, extracted fields and check results.
 */
"use client";

import { useEffect, useState } from "react";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import type { Outcome, SupplierInvoice } from "./types";
import { broadcastServiceChange, listenForServiceChanges } from "@/lib/service-sync";

export const SERVICE_URL = process.env.NEXT_PUBLIC_INVOICE_API ?? "http://127.0.0.1:8001";
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
/** A read that takes longer than this is treated as unreachable. An upload has no limit: a check can take a minute. */
const READ_TIMEOUT_MS = 15_000;
/** How often a page looks again while an invoice is still being checked. */
const RECHECK_MS = 3_000;

async function read(path: string): Promise<Response> {
  try {
    const headers = sessionHeaders();
    return await fetch(`${SERVICE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch {
    throw new Error(unreachable);
  }
}

export async function listInvoices(): Promise<SupplierInvoice[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await read(`/invoices?limit=${PAGE}&offset=${offset}`);
    if (!response.ok) throw new Error(broken);
    const rows = (await response.json()) as { id: string }[];
    ids.push(...rows.map((row) => row.id));
    if (rows.length < PAGE) break;
  }
  return Promise.all(ids.map((id) => getInvoice(id)));
}

export async function getInvoice(id: string): Promise<SupplierInvoice> {
  if (!isServiceId(id)) throw new Error("No invoice with this link. It may have been removed.");
  const response = await read(`/invoices/${id}`);
  if (response.status === 404) throw new Error("No invoice with this link. It may have been removed.");
  if (!response.ok) throw new Error(broken);
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
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Send one PDF or XML invoice. A 201 is the checked invoice. A 422 that carries a saved record is an invoice
 * the service kept but could not check; it is returned too, so its page can say why.
 */
export async function uploadInvoice(file: File): Promise<SupplierInvoice> {
  const body = new FormData();
  body.append("file", file);
  const headers = sessionHeaders(undefined, true);
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices`, {
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
  return uploadInvoice(file);
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

/** Ask every open list to load again. Used after an upload. */
export function reloadInvoices(): void {
  ++cacheRevision;
  for (const listener of listeners) listener(null);
}

/** Put one invoice the service just answered into every open list, without loading them all again. */
export function rememberInvoice(saved: SupplierInvoice): void {
  ++cacheRevision;
  cache = cache?.some((inv) => inv.id === saved.id)
    ? cache.map((inv) => (inv.id === saved.id ? saved : inv))
    : [saved, ...(cache ?? [])];
  for (const listener of listeners) listener(cache);
  broadcastServiceChange(SYNC_KEY, saved.id);
}

/** Every saved invoice, including failed processing attempts. */
export function useInvoices(): { invoices: SupplierInvoice[] | null; error: string | null } {
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = (list: SupplierInvoice[] | null) => {
      if (list) {
        setInvoices(list);
        return;
      }
      setError(null);
      setRevision((n) => n + 1);
    };
    listeners.add(listener);
    const stopSync = listenForServiceChanges(SYNC_KEY, reloadInvoices);
    return () => {
      listeners.delete(listener);
      stopSync();
    };
  }, []);
  useEffect(() => {
    let live = true;
    const startedAt = cacheRevision;
    listInvoices().then(
      (list) => {
        if (!live) return;
        if (startedAt !== cacheRevision) {
          setInvoices(cache);
          return;
        }
        cache = list;
        setInvoices(list);
        setError(null);
      },
      (reason: unknown) => {
        if (!live || startedAt !== cacheRevision) return;
        setError(reason instanceof Error ? reason.message : unreachable);
      },
    );
    return () => {
      live = false;
    };
  }, [revision]);
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
