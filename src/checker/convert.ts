/*
 * Turn one saved invoice from the checking service into the shape the screens use.
 * No other file needs the service's names.
 */
import type { CheckState, InvoiceLine, LineResult, SupplierInvoice } from "./types";

export interface ServiceLine {
  part_number: string | null;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_total: string | null;
}

export interface ServiceCheckLine {
  line_index: number;
  status: LineResult;
  reason: string;
  invoice_price: string | null;
  agreed_price: string | null;
  difference: string | null;
  overcharge: string | null;
}

export interface ServiceInvoice {
  id: string;
  filename: string;
  status: string;
  mode: string;
  created_at: string;
  price_sheet_version: string | null;
  error: string | null;
  invoice: {
    supplier_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    currency: string | null;
    subtotal: string | null;
    tax: string | null;
    invoice_total: string | null;
    lines: ServiceLine[];
  } | null;
  check: {
    overcharge_total: string | null;
    lines: ServiceCheckLine[];
    warnings: string[];
  } | null;
}

/** For showing only. The service does every sum, so no arithmetic is done on these. */
const numberOf = (value: string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const IN_PROGRESS = ["reading", "extracting", "checking"];

const stateOf = (status: string): CheckState => {
  if (status === "completed") return "checked";
  return IN_PROGRESS.includes(status) ? "checking" : "failed";
};

const errorOf = (saved: ServiceInvoice): string | null => {
  if (saved.status === "failed") return saved.error;
  if (stateOf(saved.status) === "failed") return `The service sent a status this screen does not know: ${saved.status}`;
  return null;
};

export function toSupplierInvoice(saved: ServiceInvoice): SupplierInvoice {
  const invoice = saved.invoice;
  const checks = new Map((saved.check?.lines ?? []).map((line) => [line.line_index, line]));
  const lines: InvoiceLine[] = (invoice?.lines ?? []).map((line, index) => {
    const check = checks.get(index);
    return {
      part: line.part_number,
      description: line.description ?? "",
      quantity: numberOf(line.quantity),
      unitPrice: numberOf(line.unit_price),
      lineTotal: numberOf(line.line_total),
      // The service gives one result per line. A line without one is never shown as passed.
      result: check?.status ?? "needs_person",
      sheetPrice: numberOf(check?.agreed_price),
      difference: numberOf(check?.difference),
      reason: check?.reason ?? "The check gave no result for this line.",
      overcharge: numberOf(check?.overcharge),
    };
  });
  return {
    id: saved.id,
    fileName: saved.filename,
    uploadedAt: saved.created_at,
    state: stateOf(saved.status),
    supplier: invoice?.supplier_name ?? null,
    number: invoice?.invoice_number ?? null,
    date: invoice?.invoice_date ?? null,
    currency: invoice?.currency ?? null,
    subtotal: numberOf(invoice?.subtotal),
    tax: numberOf(invoice?.tax),
    total: numberOf(invoice?.invoice_total),
    lines,
    priceSheet: saved.price_sheet_version,
    overchargeTotal: saved.check ? numberOf(saved.check.overcharge_total) : null,
    fixture: saved.mode === "fixture",
    warnings: saved.check?.warnings ?? [],
    error: errorOf(saved),
  };
}
