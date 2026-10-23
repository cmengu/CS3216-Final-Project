/*
 * The review step: which outcomes an invoice may be given, what a decided invoice is called,
 * the dispute note for the supplier, and the CSV of invoices ready to pay. Pure functions only.
 * The service holds the same outcome rules and refuses anything else (PUT /invoices/{id}/outcome).
 */
import { amount, newestFirst, problemLines, supersededBy, totalKnown, uploadedLabel } from "./summary";
import type { InvoiceLine, Outcome, SupplierInvoice } from "./types";

/** The service's limit on a reason, in characters. */
export const REASON_MAX = 500;

/** A different version alone may be a legacy file-based check, rather than a later upload. */
export function hasNewerMasterList(inv: SupplierInvoice, master: { version: string; uploadedAt: string } | null): boolean {
  return !inv.fixture && inv.state === "checked" && !!inv.priceSheet && !!master?.version
    && inv.priceSheet !== master.version && Date.parse(master.uploadedAt) > Date.parse(inv.uploadedAt);
}

/** A line the service priced above the sheet. Its own difference says so; nothing is worked out here. */
export const overSheet = (l: InvoiceLine) => l.result === "price_mismatch" && l.difference !== null && l.difference > 0;

export interface Choices {
  /** Checked in full, a total the service stands behind, and every line a match. */
  pay: boolean;
  /** Anything finished that is not clear: it can be paid only with a reason. */
  payAnyway: boolean;
  /** A line is over the sheet price. */
  raise: boolean;
}

/** The outcomes this invoice may be given. None while it is still being checked. */
export function choices(inv: SupplierInvoice): Choices {
  if (inv.state === "checking") return { pay: false, payAnyway: false, raise: false };
  const checked = inv.state === "checked";
  const pay = checked && totalKnown(inv) && inv.lines.length > 0 && problemLines(inv).length === 0;
  return { pay, payAnyway: !pay, raise: checked && inv.lines.some(overSheet) };
}

/** True when this outcome may be saved on this invoice, by the same rule the service applies. */
export function allowed(inv: SupplierInvoice, outcome: Outcome, reason: string | null = null): boolean {
  const c = choices(inv);
  if (outcome === "ready_to_pay") return c.pay;
  if (outcome === "raise_with_supplier") return c.raise;
  const r = (reason ?? "").trim();
  return c.payAnyway && r.length > 0 && r.length <= REASON_MAX;
}

/** The words for each outcome: [label class, text]. */
export const OUTCOME: Record<Outcome, [string, string]> = {
  ready_to_pay: ["l-good", "Ready to pay"],
  ready_to_pay_anyway: ["l-warn", "Ready to pay anyway"],
  raise_with_supplier: ["l-bad", "Raise with supplier"],
};

/** "Decided Today 10:42", from the service's time and the reader's clock. */
export const decidedLabel = (inv: SupplierInvoice, now: Date = new Date()) => (inv.decidedAt ? `Decided ${uploadedLabel(inv.decidedAt, now)}` : "");

/**
 * The next invoice still to decide after this one, in the list's order (newest upload first),
 * coming round to the top. Never one still being checked, nor a failed attempt sent again since.
 */
export function nextToDecide(list: SupplierInvoice[], currentId: string): SupplierInvoice | null {
  const open = newestFirst(list).filter((inv) => inv.id === currentId || (!inv.outcome && inv.state !== "checking" && !supersededBy(inv, list)));
  const at = open.findIndex((inv) => inv.id === currentId);
  const after = at < 0 ? open : [...open.slice(at + 1), ...open.slice(0, at)];
  return after.find((inv) => inv.id !== currentId) ?? null;
}

/** "2 Oct 2026" from the invoice's own "2026-10-02"; any other text as it was read. */
export function invoiceDate(date: string | null): string | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A unit price for the supplier, never rounded past what the service sent (up to six decimals). */
const exact = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const each = (n: number | null) => (n === null ? "not read" : `${exact(n)} each`);

/**
 * Plain text for the supplier: the lines charged above the agreed price and the service's total
 * over. Every figure is the service's or the invoice's own; a total the service will not stand
 * behind is said to be unconfirmed, never added up here. Null when no line is over the sheet.
 */
export function disputeNote(inv: SupplierInvoice): string | null {
  const over = inv.lines.filter(overSheet);
  if (!over.length) return null;
  const date = invoiceDate(inv.date);
  const which = [inv.number ? `Invoice ${inv.number}` : `The invoice in ${inv.fileName}`, inv.supplier ? `from ${inv.supplier}` : "", date ? `dated ${date}` : ""]
    .filter(Boolean)
    .join(" ");
  const cur = inv.currency ? `${inv.currency} ` : "";
  const lines = over.map((l) => {
    const name = [l.part, l.description].filter(Boolean).join(", ") || "A line with no part number or description";
    const qty = l.quantity === null ? "Quantity not read" : `Quantity ${l.quantity.toLocaleString("en-SG")}`;
    const by = l.overcharge != null ? ` Over by ${cur}${amount(l.overcharge)}.` : ` Over by ${exact(l.difference!)} each.`;
    return `${name}\n  ${qty}. Charged ${each(l.unitPrice)}, agreed ${each(l.sheetPrice)}.${by}`;
  });
  const total =
    inv.overchargeTotal != null && totalKnown(inv)
      ? `Total charged above the agreed prices: ${cur}${amount(inv.overchargeTotal)}`
      : "The total over could not be confirmed, because the invoice's own sums do not agree.";
  return [`${which} charges above the agreed price on ${over.length} line${over.length === 1 ? "" : "s"}:`, ...lines, total].join("\n\n");
}

/** The CSV's columns, in order. The last one marks replayed answers. */
export const CSV_COLUMNS = ["Supplier", "Number", "Date", "Currency", "Total", "Outcome", "Reason", "File", "Decision time", "Check"];

/**
 * One CSV cell. Text read from a PDF or typed by a person is quoted when it must be, and a cell
 * that a spreadsheet would run as a formula is prefixed with an apostrophe.
 */
export function csvCell(value: string | null | undefined, text = true): string {
  let v = value ?? "";
  if (text && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** An amount as plain digits for a spreadsheet, keeping any decimals beyond two as the service sent them. */
const plain = (n: number | null) => {
  if (n === null) return "";
  const s = String(n);
  return (s.split(".")[1]?.length ?? 0) >= 2 ? s : n.toFixed(2);
};

/** Invoices with a ready-to-pay outcome, by invoice date (undated last), then by decision time. */
export function readyToPay(list: SupplierInvoice[]): SupplierInvoice[] {
  return list
    .filter((inv) => inv.outcome === "ready_to_pay" || inv.outcome === "ready_to_pay_anyway")
    .sort((a, b) => (a.date ?? "￿").localeCompare(b.date ?? "￿") || (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""));
}

/** The export of invoices ready to pay. Fixture invoices say so in the last column. */
export function readyToPayCsv(list: SupplierInvoice[]): string {
  const rows = readyToPay(list).map((inv) =>
    [
      csvCell(inv.supplier),
      csvCell(inv.number),
      csvCell(inv.date),
      csvCell(inv.currency),
      plain(inv.total),
      OUTCOME[inv.outcome!][1],
      csvCell(inv.outcomeReason),
      csvCell(inv.fileName),
      csvCell(inv.decidedAt, false),
      csvCell(inv.fixture ? "Fixture answers, not a live check" : "Live"),
    ].join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** "ready-to-pay-2026-10-15.csv", from the reader's own date. */
export function csvName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ready-to-pay-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
