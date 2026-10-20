/*
 * What the Invoices page and an invoice's page show, worked out from the check result. Pure
 * functions only, so the screens stay the same when the data starts coming from the service.
 */
import type { InvoiceLine, LineResult, SupplierInvoice } from "./types";

/**
 * What the check found, as one word. A PDF the service could not finish is its own kind, so an
 * unread file never passes for a priced problem. Each row's label says which kind it is.
 */
export type CheckPile = "look" | "failed" | "checking" | "match";

/** The two piles the Invoices page sorts invoices into: no outcome yet, and decided. */
export type Pile = "decide" | "done";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "1 invoice", "3 invoices". */
export const invoiceCount = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;

/** An amount with thousands separators and two decimals: 1,284.50. */
export const amount = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A unit price as printed, keeping up to four decimals: 0.0085, 0.385, 0.42 → 0.42. */
export const unitPrice = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * How much one line charges over the price sheet. The service's own figure whenever it sent
 * the line; a line it could not price counts as nothing. Only a sample line is worked out here.
 */
export function lineOver(l: InvoiceLine): number {
  if (l.overcharge !== undefined) return l.overcharge ?? 0;
  if (l.result !== "price_mismatch" || l.difference === null || l.quantity === null || l.difference <= 0) return 0;
  return round2(l.difference * l.quantity);
}

/**
 * The invoice's overcharge. The service's own total whenever it checked the invoice; when it
 * claims nothing, this is nothing. Only a sample invoice adds up its lines.
 */
export const overcharge = (inv: SupplierInvoice) =>
  inv.overchargeTotal !== undefined ? (inv.overchargeTotal ?? 0) : round2(inv.lines.reduce((a, l) => a + lineOver(l), 0));

/**
 * True when the service stands behind the invoice's overcharge: it was checked and sent a total.
 * A null total means part of the check was uncertain, so "no overcharge" cannot be claimed.
 */
export const totalKnown = (inv: SupplierInvoice) => inv.state === "checked" && inv.overchargeTotal !== null;

export const problemLines = (inv: SupplierInvoice) => inv.lines.filter((l) => l.result !== "match");

export function pileOf(inv: SupplierInvoice): CheckPile {
  if (inv.state === "checking") return "checking";
  if (inv.state === "failed") return "failed";
  if (problemLines(inv).length || !totalKnown(inv)) return "look";
  return "match";
}

/** To decide until the clerk saves an outcome; Done after. */
export const reviewPile = (inv: SupplierInvoice): Pile => (inv.outcome ? "done" : "decide");

/** The step a failed invoice stopped at, from the service's "step: reason". */
const failedStep = (inv: SupplierInvoice) => inv.error?.match(/^(reading|extracting|checking):/)?.[1] ?? null;

/** The status label on an invoice's row: [label class, text]. */
export function invoiceLabel(inv: SupplierInvoice): [string, string] {
  if (inv.state === "checking") return ["l-info", "Checking…"];
  if (inv.state === "failed") {
    const step = failedStep(inv);
    return ["l-bad", step === "reading" || step === "extracting" ? "Could not read" : "Could not check"];
  }
  const over = overcharge(inv);
  if (over > 0) return ["l-bad", `${inv.currency ?? ""} ${amount(over)} over`.trim()];
  if (inv.lines.some((l) => l.result === "needs_person") || !totalKnown(inv)) return ["l-warn", "Pending"];
  if (inv.lines.some((l) => l.result === "unknown_part")) return ["l-bad", "Unknown"];
  return ["l-good", "All match"];
}

/** The short line under an invoice's name in the list. */
export function invoiceMeta(inv: SupplierInvoice): string {
  if (inv.state === "checking") return "Reading the PDF";
  if (inv.state === "failed") return failure(inv);
  const n = problemLines(inv).length;
  const all = inv.lines.length;
  if (n) return `${n} of ${all} lines ${n === 1 ? "needs" : "need"} a look`;
  if (!totalKnown(inv)) return inv.warnings?.[0] ?? "The check could not confirm the totals";
  return `${all} line${all === 1 ? "" : "s"}`;
}

const STEP_FAILED: Record<string, string> = {
  reading: "The text in this PDF could not be read.",
  extracting: "The PDF was read, but the invoice's details could not be picked out of it.",
  checking: "The invoice was read, but its lines could not be checked against the price sheet.",
};

/**
 * Why a failed invoice failed, as one plain sentence. The service's own "step: reason" stays on
 * the invoice for the details; it is not the first thing a person reads.
 */
export function failure(inv: SupplierInvoice): string {
  const step = failedStep(inv);
  if (step) return STEP_FAILED[step];
  return inv.error ? "The checking service could not finish this invoice." : "The checking service did not say what went wrong.";
}

/** "Today 10:42", "Yesterday", "25 Sept", from the upload time and the reader's own clock. */
export function uploadedLabel(uploadedAt: string, now: Date = new Date()): string {
  const at = new Date(uploadedAt);
  if (Number.isNaN(at.getTime())) return "";
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return `Today ${at.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

/** Newest upload first. */
export const newestFirst = (list: SupplierInvoice[]) => [...list].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

export interface Summary {
  /** Overcharge found, per currency, in the order the currencies first appear. */
  over: [string, number][];
  /** How many invoices the overcharge comes from. */
  overInvoices: number;
  /** Invoices checked in full: the service stands behind their overcharge, even when it is none. */
  known: number;
  /** Invoices whose overcharge is not known: still checking, not finished, or checked with an uncertain total. */
  unknown: number;
  /** To decide newest upload first; Done newest decision first. */
  piles: Record<Pile, SupplierInvoice[]>;
}

/**
 * A newer upload of the same PDF, when there is one, so this failed attempt no longer counts.
 * Only an undecided failed attempt is set aside; two finished checks of one file both stay, and
 * so does a failed attempt someone already decided on.
 */
export function supersededBy(inv: SupplierInvoice, list: SupplierInvoice[]): SupplierInvoice | null {
  if (inv.state !== "failed" || !inv.documentHash || inv.outcome) return null;
  return newestFirst(list).find((x) => x.id !== inv.id && x.documentHash === inv.documentHash && x.uploadedAt > inv.uploadedAt) ?? null;
}

/** The totals boxes on the Invoices page, and the invoices in each pile (newest first). */
export function summarize(list: SupplierInvoice[]): Summary {
  const over = new Map<string, number>();
  let overInvoices = 0;
  let known = 0;
  let unknown = 0;
  const piles: Record<Pile, SupplierInvoice[]> = { decide: [], done: [] };
  for (const inv of newestFirst(list)) {
    if (supersededBy(inv, list)) continue;
    piles[reviewPile(inv)].push(inv);
    if (totalKnown(inv)) known++;
    else unknown++;
    const o = overcharge(inv);
    if (o > 0) {
      overInvoices++;
      const cur = inv.currency ?? "";
      over.set(cur, round2((over.get(cur) ?? 0) + o));
    }
  }
  piles.done.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  return { over: [...over], overInvoices, known, unknown, piles };
}

/**
 * The words in the overcharge box. "None found" is said only about invoices checked in full,
 * and the box always says how many invoices it cannot speak for yet.
 */
export function overchargeBox(s: Summary): { value: string; note: string; found: boolean } {
  const open = s.unknown ? `${invoiceCount(s.unknown)} not checked in full` : "";
  if (s.over.length) {
    const value = s.over.map(([cur, n]) => `${cur} ${amount(n)}`.trim()).join(" · ");
    return { value, note: [`on ${invoiceCount(s.overInvoices)}`, open].filter(Boolean).join(" · "), found: true };
  }
  if (!s.known && !s.unknown) return { value: "Nothing yet", note: "Upload a PDF to check it", found: false };
  if (!s.known) return { value: "Not known yet", note: open, found: false };
  return { value: "None found", note: s.unknown ? `in ${invoiceCount(s.known)} checked in full · ${open}` : `in all ${invoiceCount(s.known)}`, found: false };
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
  needs_person: ["l-warn", "Pending"],
  unknown_part: ["l-bad", "Unknown"],
  match: ["l-good", "Match"],
};

/** A line's label, saying which way a price mismatch goes: [label class, text]. */
export function resultLabel(l: InvoiceLine): [string, string] {
  if (l.result === "price_mismatch" && l.difference !== null && l.difference > 0) return ["l-bad", "Over sheet price"];
  if (l.result === "price_mismatch" && l.difference !== null && l.difference < 0) return ["l-warn", "Under sheet price"];
  return RESULT[l.result];
}

/** A price sheet's name, or the start of its fingerprint when the service sends only that. */
export const sheetName = (sheet: string | null) => (!sheet ? "the price sheet" : /^[0-9a-f]{32,}$/i.test(sheet) ? `price sheet ${sheet.slice(0, 8)}` : sheet);
