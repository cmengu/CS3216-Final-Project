/*
 * The invoice checker's data, as the build plan's agreed fields and check result describe it.
 * backend/schema.py is the source of truth once it lands; this file mirrors it and changes only
 * when that file does.
 */

/** What the check says about one line. */
export type LineResult = "match" | "price_mismatch" | "unknown_part" | "needs_person";

export interface InvoiceLine {
  part: string | null;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  result: LineResult;
  /** The price sheet's unit price; null when the part is not on the sheet. */
  sheetPrice: number | null;
  /** Unit price minus sheet price, per unit; null when there is nothing to compare. */
  difference: number | null;
  /** Why the line is not a match, in plain words; empty for a match. */
  reason: string;
  /**
   * The service's overcharge on this line. Null means it could not price the line.
   * Absent only on sample invoices, which work it out from the difference.
   */
  overcharge?: number | null;
}

/**
 * What the AP clerk decided. Ready to pay only for an invoice checked in full with every line
 * matching; ready to pay anyway with a reason; raise with supplier when a line is over the sheet.
 */
export type Outcome = "ready_to_pay" | "ready_to_pay_anyway" | "raise_with_supplier";

/** Where the invoice is in the pipeline. */
export type CheckState = "checking" | "checked" | "failed";

export interface SupplierInvoice {
  id: string;
  fileName: string;
  /** The service's fingerprint of the PDF. Two uploads of the same file share it. */
  documentHash?: string | null;
  /** When the PDF was uploaded, as local ISO date and time. */
  uploadedAt: string;
  state: CheckState;
  /** The fields below are null until the reading steps have filled them. */
  supplier: string | null;
  number: string | null;
  date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lines: InvoiceLine[];
  /** The price sheet the check used. */
  priceSheet: string | null;
  /**
   * The service's overcharge total. Absent on sample invoices, which add the lines up.
   * Null means the service claims nothing, because the invoice's own sums do not agree.
   */
  overchargeTotal?: number | null;
  /** True when the service replayed a known answer. */
  fixture?: boolean;
  /** What the service says about the whole invoice, such as "1 line not priced". */
  warnings?: string[];
  /** The step that failed and why, in the service's words. Null unless the check failed. */
  error?: string | null;
  /** The clerk's decision, saved in the service. Null until someone decides. */
  outcome?: Outcome | null;
  /** Why it can be paid anyway, in the clerk's words. */
  outcomeReason?: string | null;
  /** When the service saved the decision, as an ISO time. */
  decidedAt?: string | null;
}
