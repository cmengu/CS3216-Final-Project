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
  status: LineResult;
  reason: string;
  invoice_price: string | null;
  agreed_price: string | null;
  difference: string | null;
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
  } | null;
}

const numberOf = (value: string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const stateOf = (status: string): CheckState => {
  if (status === "completed") return "checked";
  if (status === "failed") return "failed";
  return "checking";
};

export function toSupplierInvoice(saved: ServiceInvoice): SupplierInvoice {
  const invoice = saved.invoice;
  const checks = saved.check?.lines ?? [];
  const lines: InvoiceLine[] = (invoice?.lines ?? []).map((line, index) => {
    const check = checks[index];
    return {
      part: line.part_number,
      description: line.description ?? "",
      quantity: numberOf(line.quantity),
      unitPrice: numberOf(line.unit_price),
      lineTotal: numberOf(line.line_total),
      result: check?.status ?? "needs_person",
      sheetPrice: numberOf(check?.agreed_price),
      difference: numberOf(check?.difference),
      reason: check?.reason ?? "",
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
  };
}
