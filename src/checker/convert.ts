import { tableRows, type TableDocument } from "@/components/pdfEvidence";
/*
 * Turn one saved invoice from the checking service into the shape the screens use.
 * No other file needs the service's names.
 */
import type { CheckState, InvoiceLine, LineResult, Outcome, SourceBlock, SupplierInvoice } from "./types";

export interface ServiceLine {
  part_number: string | null;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_total: string | null;
  unit?: string | null;
}

interface ServiceLocation {
  page: number;
  bbox?: { l: number; t: number; r: number; b: number; coord_origin?: string } | null;
  page_width?: number | null;
  page_height?: number | null;
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
  document_hash?: string | null;
  status: string;
  mode: string;
  created_at: string;
  price_sheet_version: string | null;
  error: string | null;
  /** Absent from a service that does not save decisions yet. */
  outcome?: string | null;
  outcome_reason?: string | null;
  decided_at?: string | null;
  invoice: {
    supplier_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    currency: string | null;
    subtotal: string | null;
    tax: string | null;
    invoice_total: string | null;
    purchase_order?: string | null;
    tax_rate?: string | null;
    lines: ServiceLine[];
  } | null;
  document?: {
    docling_document?: TableDocument;
    page_count?: number;
    pages?: { page_number: number; display_rotation?: number }[];
    blocks?: { text: string; locations?: ServiceLocation[] }[];
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

const OUTCOMES: string[] = ["ready_to_pay", "ready_to_pay_anyway", "raise_with_supplier"];

/** An outcome this screen does not know is shown as no decision, never as one it might mean. */
const outcomeOf = (value: string | null | undefined): Outcome | null => (value && OUTCOMES.includes(value) ? (value as Outcome) : null);

export function toSupplierInvoice(saved: ServiceInvoice): SupplierInvoice {
  const invoice = saved.invoice;
  const checks = new Map((saved.check?.lines ?? []).map((line) => [line.line_index, line]));
  const lines: InvoiceLine[] = (invoice?.lines ?? []).map((line, index) => {
    const check = checks.get(index);
    return {
      part: line.part_number,
      description: line.description ?? "",
      quantity: numberOf(line.quantity),
      // The price the service compared with the master list, after any printed exchange rate, so it
      // is in the same currency as sheetPrice. The printed price only when the service compared none.
      unitPrice: numberOf(check?.invoice_price ?? line.unit_price),
      lineTotal: numberOf(line.line_total),
      // The service gives one result per line. A line without one is never shown as passed.
      result: check?.status ?? "needs_person",
      sheetPrice: numberOf(check?.agreed_price),
      difference: numberOf(check?.difference),
      // Older saved checks retain the original backend wording.
      reason: check?.reason === "No exact item or code-free description match in the agreement"
        ? "Not exist in Master Sheet"
        : check?.reason ?? "The check gave no result for this line.",
      overcharge: numberOf(check?.overcharge),
      unit: line.unit ?? null,
    };
  });
  return {
    id: saved.id,
    fileName: saved.filename,
    documentHash: saved.document_hash ?? null,
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
    outcome: outcomeOf(saved.outcome),
    outcomeReason: outcomeOf(saved.outcome) ? (saved.outcome_reason ?? null) : null,
    decidedAt: outcomeOf(saved.outcome) ? (saved.decided_at ?? null) : null,
    purchaseOrder: invoice?.purchase_order ?? null,
    taxRate: numberOf(invoice?.tax_rate),
    pageCount: saved.document?.page_count ?? null,
    blocks: blocksOf(saved),
    pageRotations: Object.fromEntries((saved.document?.pages ?? []).map((p) => [p.page_number, p.display_rotation ?? 0])),
  };
}

/** Only the text and positions; the reader's full document is not kept. */
function blocksOf(saved: ServiceInvoice): SourceBlock[] {
  return [...tableRows(saved.document?.docling_document, (saved.document?.pages ?? []).filter((p) => p.display_rotation).map((p) => p.page_number)), ...(saved.document?.blocks ?? []).map((b) => ({
    text: b.text,
    locations: (b.locations ?? []).map((l) => ({
      page: l.page,
      bbox: l.bbox ?? null,
      pageWidth: l.page_width ?? null,
      pageHeight: l.page_height ?? null,
    })),
  }))];
}
