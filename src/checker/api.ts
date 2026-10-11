/*
 * The one place the screens get invoices from. The list is still the invented sample.
 * One invoice is read from the checking service when that service answers.
 */
"use client";

import { useEffect, useState } from "react";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { SAMPLE_INVOICES } from "./sample";
import type { SupplierInvoice } from "./types";

export const SERVICE_URL = process.env.NEXT_PUBLIC_INVOICE_API ?? "http://127.0.0.1:8000";

const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

export async function listInvoices(): Promise<SupplierInvoice[]> {
  return SAMPLE_INVOICES;
}

export async function getInvoice(id: string): Promise<SupplierInvoice> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/invoices/${id}`);
  } catch {
    throw new Error("The checking service could not be reached.");
  }
  if (response.status === 404) throw new Error("No invoice with this link. It may have been removed.");
  if (!response.ok) throw new Error("The checking service could not be reached.");
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
        if (live) setInvoices(list);
      },
      () => {
        if (live) setError("Invoices could not be loaded. Try again in a moment.");
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
