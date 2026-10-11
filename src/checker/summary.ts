/*
 * What the Invoices page and an invoice's page show, worked out from the check result. Pure
 * functions only, so the screens stay the same when the data starts coming from the service.
 */
import type { InvoiceLine, LineResult, SupplierInvoice } from "./types";

/** The three piles the Invoices page sorts invoices into. A PDF that could not be read needs a look. */
export type Pile = "look" | "checking" | "match";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An amount with thousands separators and two decimals: 1,284.50. */
export const amount = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A unit price as printed, keeping up to four decimals: 0.0085, 0.385, 0.42 → 0.42. */
export const unitPrice = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** How much one line charges over the price sheet; 0 unless it is a price mismatch charged above the sheet. */
export function lineOver(l: InvoiceLine): number {
  if (l.result !== "price_mismatch" || l.difference === null || l.quantity === null || l.difference <= 0) return 0;
  return round2(l.difference * l.quantity);
}

/** The service's total when it sent one. Sample invoices still add up their lines. */
export const overcharge = (inv: SupplierInvoice) =>
  inv.overchargeTotal != null ? round2(inv.overchargeTotal) : round2(inv.lines.reduce((a, l) => a + lineOver(l), 0));

export const problemLines = (inv: SupplierInvoice) => inv.lines.filter((l) => l.result !== "match");

export function pileOf(inv: SupplierInvoice): Pile {
  if (inv.state === "checking") return "checking";
  if (inv.state === "failed" || problemLines(inv).length) return "look";
  return "match";
}

/** The status label on an invoice's row: [label class, text]. */
export function invoiceLabel(inv: SupplierInvoice): [string, string] {
  if (inv.state === "checking") return ["l-info", "Checking…"];
  if (inv.state === "failed") return ["l-bad", "Could not read"];
  const over = overcharge(inv);
  if (over > 0) return ["l-bad", `${inv.currency ?? ""} ${amount(over)} over`.trim()];
  if (inv.lines.some((l) => l.result === "needs_person")) return ["l-warn", "Needs a person"];
  if (inv.lines.some((l) => l.result === "unknown_part")) return ["l-purple", "Unknown part"];
  return ["l-good", "All match"];
}

/** The short line under an invoice's name in the list. */
export function invoiceMeta(inv: SupplierInvoice): string {
  if (inv.state === "checking") return "Reading the PDF";
  if (inv.state === "failed") return "The PDF could not be read. Open it to check by hand.";
  const n = problemLines(inv).length;
  const all = inv.lines.length;
  return n ? `${n} of ${all} lines ${n === 1 ? "needs" : "need"} a look` : `${all} line${all === 1 ? "" : "s"}`;
}

/** Newest upload first. */
export const newestFirst = (list: SupplierInvoice[]) => [...list].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

export interface Summary {
  /** Overcharge found, per currency, in the order the currencies first appear. */
  over: [string, number][];
  /** How many invoices the overcharge comes from. */
  overInvoices: number;
  piles: Record<Pile, SupplierInvoice[]>;
}

/** The totals boxes on the Invoices page, and the invoices in each pile (newest first). */
export function summarize(list: SupplierInvoice[]): Summary {
  const over = new Map<string, number>();
  let overInvoices = 0;
  const piles: Record<Pile, SupplierInvoice[]> = { look: [], checking: [], match: [] };
  for (const inv of newestFirst(list)) {
    piles[pileOf(inv)].push(inv);
    const o = overcharge(inv);
    if (o > 0) {
      overInvoices++;
      const cur = inv.currency ?? "";
      over.set(cur, round2((over.get(cur) ?? 0) + o));
    }
  }
  return { over: [...over], overInvoices, piles };
}

const ORDER: Record<LineResult, number> = { price_mismatch: 0, needs_person: 1, unknown_part: 2, match: 3 };

/** The invoice's lines with the problems first: biggest overcharge, then needs a person, then unknown parts, then matches. */
export function problemsFirst(lines: InvoiceLine[]): InvoiceLine[] {
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => ORDER[a.l.result] - ORDER[b.l.result] || lineOver(b.l) - lineOver(a.l) || a.i - b.i)
    .map((x) => x.l);
}

/** The words on a line's result label: [label class, text]. */
export const RESULT: Record<LineResult, [string, string]> = {
  price_mismatch: ["l-bad", "Price mismatch"],
  needs_person: ["l-warn", "Needs a person"],
  unknown_part: ["l-purple", "Unknown part"],
  match: ["l-good", "Match"],
};
