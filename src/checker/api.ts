/*
 * The one place the screens get invoices from. The list is the checking service.
 * A summary row has no supplier, number, or overcharge, so each id is read in full.
 */
"use client";

import { useEffect, useState } from "react";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import type { SupplierInvoice } from "./types";

export const SERVICE_URL = process.env.NEXT_PUBLIC_INVOICE_API ?? "http://127.0.0.1:8000";

const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

const unreachable = "The checking service could not be reached.";

export async function listInvoices(): Promise<SupplierInvoice[]> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices`);
  } catch {
    throw new Error(unreachable);
  }
  if (!response.ok) throw new Error(unreachable);
  const rows = (await response.json()) as { id: string }[];
  return Promise.all(rows.map((row) => getInvoice(row.id)));
}

export async function getInvoice(id: string): Promise<SupplierInvoice> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices/${id}`);
  } catch {
    throw new Error(unreachable);
  }
  if (response.status === 404) throw new Error("No invoice with this link. It may have been removed.");
  if (!response.ok) throw new Error(unreachable);
  return toSupplierInvoice((await response.json()) as ServiceInvoice);
}

let cache: SupplierInvoice[] | null = null;

/** Every invoice, or null while loading. The last answer is kept, so moving between pages does not flash. */
export function useInvoices(): { invoices: SupplierInvoice[] | null; error: string | null } {
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listInvoices().then(
      (list) => {
        cache = list;
        if (!live) return;
        setInvoices(list);
        setError(null);
      },
      (reason: unknown) => {
        if (!live) return;
        cache = null;
        setInvoices(null);
        setError(reason instanceof Error ? reason.message : unreachable);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return { invoices, error };
}

/** The service's copy of one invoice. Null while loading. An error never substitutes a sample. */
export function useRemoteInvoice(id: string): {
  invoice: SupplierInvoice | null;
  error: string | null;
  loading: boolean;
} {
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isServiceId(id));
  useEffect(() => {
    if (!isServiceId(id)) return;
    let live = true;
    getInvoice(id).then(
      (found) => {
        if (!live) return;
        setInvoice(found);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!live) return;
        setInvoice(null);
        setError(reason instanceof Error ? reason.message : "The checking service could not be reached.");
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  return { invoice, error, loading };
}
