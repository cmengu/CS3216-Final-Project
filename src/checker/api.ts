/*
 * The one place the screens get invoices from. The list is the checking service, with an
 * automatic fallback to DEMO_INVOICES when the local checking service is not running so the UI
 * can always be inspected and interacted with.
 */
"use client";

import { useEffect, useState } from "react";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { DEMO_INVOICES } from "./sample";
import type { Outcome, SupplierInvoice } from "./types";

export const SERVICE_URL = process.env.NEXT_PUBLIC_INVOICE_API ?? "http://127.0.0.1:8000";

const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

let demoStore: SupplierInvoice[] = structuredClone(DEMO_INVOICES);

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
    return await fetch(`${SERVICE_URL}${path}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
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
  const response = await read(`/invoices/${id}`);
  if (response.status === 404) throw new Error("No invoice with this link. It may have been removed.");
  if (!response.ok) throw new Error(broken);
  return toSupplierInvoice((await response.json()) as ServiceInvoice);
}

/** One sentence for a file that must not be sent at all. Null means it may be sent. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files can be checked.";
  if (file.size > MAX_BYTES) return "That PDF is over the 20 MB limit.";
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
  if (status === 413) return "That PDF is over the 20 MB limit.";
  if (status === 422 || status === 415 || status === 400) {
    return typeof detail === "string" && detail ? `This file could not be checked. ${detail}` : "This invoice could not be checked.";
  }
  return broken;
}

/**
 * Send one PDF. A 201 is the checked invoice. A 422 that carries a saved record is an invoice
 * the service kept but could not check; it is returned too, so its page can say why.
 */
export async function uploadInvoice(file: File): Promise<SupplierInvoice> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices`, { method: "POST", body });
  } catch {
    throw new Error(unreachable);
  }
  const answer = (await response.json().catch(() => null)) as (Partial<ServiceInvoice> & { detail?: unknown }) | null;
  if (response.status === 201 || (response.status === 422 && typeof answer?.id === "string")) {
    return toSupplierInvoice(answer as ServiceInvoice);
  }
  throw new Error(uploadFailure(response.status, answer?.detail) ?? broken);
}

/** Where the service keeps the PDF exactly as it was uploaded. */
export const invoiceFileUrl = (id: string) => `${SERVICE_URL}/invoices/${id}/file`;

/**
 * Send a failed invoice's own PDF through the check again. The service keeps the first attempt,
 * so this saves a new invoice; the list sets the failed attempt aside once a newer one exists.
 */
export async function retryInvoice(inv: SupplierInvoice): Promise<SupplierInvoice> {
  const response = await read(`/invoices/${inv.id}/file`);
  if (response.status === 404) throw new Error("The original PDF is no longer kept, so it cannot be checked again. Upload it again.");
  if (!response.ok) throw new Error(broken);
  const file = new File([await response.blob()], inv.fileName, { type: "application/pdf" });
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
 * same rules as the screens and answers the saved invoice. For non-UUID demo invoices, updates
 * the in-memory demo store directly so the UI works without the backend running.
 */
export async function decideInvoice(id: string, outcome: Outcome | null, reason: string | null = null): Promise<SupplierInvoice> {
  if (!isServiceId(id)) {
    const existing = demoStore.find((inv) => inv.id === id);
    if (!existing) throw new Error("No invoice with this link. It may have been removed.");
    const updated: SupplierInvoice = {
      ...existing,
      outcome,
      outcomeReason: outcome ? reason : null,
      decidedAt: outcome ? new Date().toISOString() : null,
    };
    demoStore = demoStore.map((inv) => (inv.id === id ? updated : inv));
    if (cache) cache = cache.map((inv) => (inv.id === id ? updated : inv));
    return updated;
  }

  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices/${id}/outcome`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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

let cache: SupplierInvoice[] | null = demoStore;
/** Each open list. Null asks it to load again; a list is the new answer to show. */
const listeners = new Set<(list: SupplierInvoice[] | null) => void>();

function mergeWithDemo(serviceList: SupplierInvoice[]): SupplierInvoice[] {
  const extras = serviceList.filter(
    (inv) => inv.state !== "failed" && !demoStore.some((d) => d.id === inv.id),
  );
  return [...extras, ...demoStore];
}

/** Ask every open list to load again. Used after an upload. */
export function reloadInvoices(): void {
  for (const listener of listeners) listener(null);
}

/** Put one invoice the service just answered into every open list, without loading them all again. */
export function rememberInvoice(saved: SupplierInvoice): void {
  demoStore = demoStore.map((inv) => (inv.id === saved.id ? saved : inv));
  if (!cache) return;
  cache = cache.map((inv) => (inv.id === saved.id ? saved : inv));
  for (const listener of listeners) listener(cache);
}

/** Every invoice, always preserving demo invoices alongside any non-failed service invoices. */
export function useInvoices(): { invoices: SupplierInvoice[] | null; error: string | null } {
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(cache ?? demoStore);
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
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    let live = true;
    listInvoices().then(
      (list) => {
        const effective = mergeWithDemo(list);
        cache = effective;
        if (!live) return;
        setInvoices(effective);
        setError(null);
      },
      () => {
        if (!live) return;
        cache = demoStore;
        setInvoices(demoStore);
        setError(null);
      },
    );
    return () => {
      live = false;
    };
  }, [revision]);
  return { invoices, error };
}

/**
 * The service's copy of one invoice, or the demo invoice when `id` is a sample ID.
 * While a service invoice is still being checked, it is read again every few seconds.
 */
export function useRemoteInvoice(id: string): {
  invoice: SupplierInvoice | null;
  error: string | null;
  loading: boolean;
  replace: (saved: SupplierInvoice) => void;
} {
  const initialDemo = !isServiceId(id) ? (demoStore.find((inv) => inv.id === id) ?? null) : null;
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(initialDemo);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isServiceId(id));
  useEffect(() => {
    if (!isServiceId(id)) {
      const found = demoStore.find((inv) => inv.id === id) ?? null;
      setInvoice(found);
      setError(found ? null : "No invoice with this link. It may have been removed.");
      setLoading(false);
      return;
    }
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
