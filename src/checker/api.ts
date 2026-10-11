/*
 * The one place the screens get invoices from. Today it serves the invented sample; on join day
 * listInvoices() calls the checking service instead (GET /invoices, agreed with Duc) and nothing
 * else changes.
 */
"use client";

import { useEffect, useState } from "react";
import { SAMPLE_INVOICES } from "./sample";
import type { SupplierInvoice } from "./types";

export async function listInvoices(): Promise<SupplierInvoice[]> {
  return SAMPLE_INVOICES;
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
