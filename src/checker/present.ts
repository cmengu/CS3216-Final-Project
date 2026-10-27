/*
 * What the redesigned screens say about an invoice: status pills, attention lines, the decision
 * bar, the supplier email, the ready-to-pay CSV and the audit trail rows. Pure functions only.
 * Every money figure is the service's own or the invoice's own; the only arithmetic here is a
 * line's difference times its quantity, to say how much a line is under (the service sends an
 * overcharge for lines over, never for lines under).
 */
import { choices, csvCell, invoiceDate, overSheet } from "./review";
import { problemLines, totalKnown } from "./summary";
import type { InvoiceLine, Outcome, SupplierInvoice } from "./types";

export type Tone = "good" | "warn" | "neutral";
export interface Pill {
  text: string;
  tone: Tone;
}

/* ------------------------------------------------------------------ money ---- */

const two = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "SGD 3,502.27". */
export const money = (n: number, cur: string | null | undefined) => `${cur ? cur + " " : ""}${two(n)}`.trim();
/** A unit price, keeping up to four decimals: 0.0047, 68.25. */
export const unit = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** "+6.00" / "-20.00" for a per-unit difference. */

/* ---------------------------------------------------------------- statuses ---- */

export const OUTCOME_PILL: Record<Outcome, Pill> = {
  ready_to_pay: { text: "Ready to pay", tone: "good" },
  raise_with_supplier: { text: "Raise with supplier", tone: "warn" },
  ready_to_pay_anyway: { text: "Paid anyway", tone: "neutral" },
};

export const LINE_PILL: Record<InvoiceLine["result"], Pill> = {
  match: { text: "Matches", tone: "good" },
  price_mismatch: { text: "Price differs", tone: "warn" },
  unknown_part: { text: "Not on master list", tone: "warn" },
  needs_person: { text: "Needs you", tone: "warn" },
};

/** The step a failed invoice stopped at, from the service's "step: reason". */
export const failedStep = (inv: SupplierInvoice) => inv.error?.match(/^(reading|extracting|checking):/)?.[1] ?? null;

/** One plain sentence for a failed invoice. */
export function failureSentence(inv: SupplierInvoice): string {
  const step = failedStep(inv);
  if (step === "extracting") return "The invoice details couldn't be found.";
  if (step === "checking") return "The lines couldn't be checked.";
  return "The file couldn't be read.";
}

/** The worst kind of line on a checked invoice, in the order the clerk should look. */
function worst(inv: SupplierInvoice): InvoiceLine["result"] | null {
  for (const r of ["price_mismatch", "unknown_part", "needs_person"] as const) if (inv.lines.some((l) => l.result === r)) return r;
  return null;
}

/** The invoice's check status, before any decision. */
export function checkPill(inv: SupplierInvoice): Pill {
  if (inv.state === "checking") return { text: "Checking…", tone: "neutral" };
  if (inv.state === "failed") return { text: "Couldn't read", tone: "warn" };
  const w = worst(inv);
  if (w === "price_mismatch") return { text: `${inv.lines.filter((l) => l.result === "price_mismatch").length} out of ${inv.lines.length} differs`, tone: "warn" };
  if (w) return LINE_PILL[w];
  if (!totalKnown(inv) || !inv.lines.length) return LINE_PILL.needs_person;
  return LINE_PILL.match;
}

/** The pill an invoice shows: its outcome once decided, else its check status. */
export const statusPill = (inv: SupplierInvoice): Pill => (inv.outcome ? OUTCOME_PILL[inv.outcome] : checkPill(inv));

/** How much one line is under the master list in total (positive number), or 0. */
export function lineUnder(l: InvoiceLine): number {
  if (l.result !== "price_mismatch" || l.difference === null || l.difference >= 0 || l.quantity === null) return 0;
  return Math.round(-l.difference * l.quantity * 100) / 100;
}

/** How much one line is over, as the service sent it, or 0. */
export const lineOverBy = (l: InvoiceLine) => (overSheet(l) ? (l.overcharge ?? 0) : 0);

/** The attention line under a queue card: "SGD 159.60 over", "SGD 20.00 under", the reason. Null when nothing needs saying. */
export function queueAttention(inv: SupplierInvoice): string | null {
  if (inv.state === "checking") return null;
  if (inv.state === "failed") return failureSentence(inv);
  const cur = inv.currency;
  const over = inv.lines.filter(overSheet);
  if (over.length) {
    if (inv.overchargeTotal != null && inv.overchargeTotal > 0) return `${money(inv.overchargeTotal, cur)} over`;
    // Invoice arithmetic may prevent a total, while individual line amounts remain confirmed.
    if (over.every((l) => l.overcharge != null && Number.isFinite(l.overcharge))) {
      const amount = over.reduce((sum, l) => sum + lineOverBy(l), 0);
      if (amount > 0) return `${money(amount, cur)} over`;
    }
    return `${over.length} line${over.length === 1 ? "" : "s"} over`;
  }
  const under = inv.lines.reduce((a, l) => a + lineUnder(l), 0);
  if (under > 0) return `${money(under, cur)} under`;
  const w = worst(inv);
  if (w === "unknown_part") {
    const n = inv.lines.filter((l) => l.result === "unknown_part").length;
    return `${n} item${n === 1 ? "" : "s"} not on the master list`;
  }
  if (w === "needs_person") return inv.lines.find((l) => l.result === "needs_person")?.reason ?? null;
  if (!totalKnown(inv)) return inv.warnings?.[0] ?? "The totals don't add up.";
  return null;
}

/* ------------------------------------------------------------------- lines ---- */

/** A short description: the first part before a comma or the first 40 characters. */
export function shortDescription(l: InvoiceLine): string {
  const d = l.description.trim();
  if (!d) return l.part ?? "No description";
  return d.length > 40 ? d.slice(0, 38).trimEnd() + "…" : d;
}

/** The attention line on a flagged line. */
export function lineAttention(l: InvoiceLine, cur: string | null): string | null {
  if (l.result === "match") return null;
  if (l.result === "price_mismatch" && l.difference !== null && l.difference !== 0) {
    const per = l.unit ? ` per ${l.unit}` : " each";
    return `${cur ? cur + " " : ""}${unit(Math.abs(l.difference))} ${l.difference > 0 ? "more" : "less"}${per} than the master list`;
  }
  if (l.result === "unknown_part") return "This item isn't on the master list.";
  return l.reason || "Check this line.";
}

/** The muted comparison row's money part: "SGD 159.60 over" / "SGD 20.00 under". */
export function lineDelta(l: InvoiceLine, cur: string | null): string | null {
  const over = lineOverBy(l);
  if (over > 0) return `${money(over, cur)} over`;
  const under = lineUnder(l);
  if (under > 0) return `${money(under, cur)} under`;
  return null;
}

/** Flagged lines first (in the invoice's order), then matching lines. Keeps the line number. */
export function orderedLines(inv: SupplierInvoice): { line: InvoiceLine; n: number }[] {
  const all = inv.lines.map((line, i) => ({ line, n: i + 1 }));
  return [...all.filter((x) => x.line.result !== "match"), ...all.filter((x) => x.line.result === "match")];
}

/** The Lines card's pill: "1 of 2 differ" or "3 match". */
export function linesPill(inv: SupplierInvoice): Pill | null {
  if (!inv.lines.length) return null;
  const n = problemLines(inv).length;
  return n ? { text: `${n} out of ${inv.lines.length} differs`, tone: "warn" } : { text: `${inv.lines.length} match`, tone: "good" };
}

/** "Tax 9%" from a rate sent as 0.09 or 9. */
export function taxLabel(rate: number | null | undefined): string {
  if (rate == null) return "Tax";
  const pct = rate <= 1 ? rate * 100 : rate;
  return `Tax ${Number(pct.toFixed(2))}%`;
}

/* ---------------------------------------------------------------- decision ---- */

export type DecisionMode = "checking" | "decided" | "pay" | "raise" | "anyway";

export interface DecisionSummary {
  mode: DecisionMode;
  title: string;
  sub: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the decision bar says and which buttons it offers. Same rules the service holds (409s). */
export function decision(inv: SupplierInvoice): DecisionSummary {
  if (inv.outcome) return { mode: "decided", title: OUTCOME_PILL[inv.outcome].text, sub: "" };
  if (inv.state === "checking") return { mode: "checking", title: "Checking…", sub: "Each invoice takes up to a minute." };
  const c = choices(inv);
  if (c.pay) return { mode: "pay", title: "Every line matches", sub: "" };
  if (inv.state === "failed") return { mode: "anyway", title: "Not checked", sub: "Try again, or pay with a reason" };
  const over = inv.lines.filter(overSheet);
  if (c.raise) {
    const lines = `${plural(over.length, "line", "lines")} above the master list`;
    if (inv.overchargeTotal != null && inv.overchargeTotal > 0) return { mode: "raise", title: `${money(inv.overchargeTotal, inv.currency)} over`, sub: lines };
    return { mode: "raise", title: lines, sub: "The total over couldn't be confirmed" };
  }
  const under = inv.lines.reduce((a, l) => a + lineUnder(l), 0);
  if (under > 0) {
    const n = inv.lines.filter((l) => lineUnder(l) > 0).length;
    return { mode: "anyway", title: `${money(under, inv.currency)} under`, sub: `${plural(n, "line", "lines")} below the master list` };
  }
  const unknown = inv.lines.filter((l) => l.result === "unknown_part").length;
  if (unknown) return { mode: "anyway", title: `${plural(unknown, "item", "items")} not on the master list`, sub: "Pay with a reason, or check the master list" };
  const needs = inv.lines.filter((l) => l.result === "needs_person").length;
  if (needs) return { mode: "anyway", title: `${plural(needs, "line needs", "lines need")} you`, sub: "Pay with a reason" };
  return { mode: "anyway", title: "The totals couldn't be confirmed", sub: "Pay with a reason" };
}

/** The one line in the Pay anyway dialog. */
export function payAnywayLine(inv: SupplierInvoice): string {
  const name = inv.number ?? inv.fileName;
  if (inv.state === "failed") return `${name} couldn't be read, so no lines were checked.`;
  const d = decision(inv);
  if (d.mode === "raise" && inv.overchargeTotal != null && inv.overchargeTotal > 0) return `${name} is ${money(inv.overchargeTotal, inv.currency)} over the master list.`;
  const under = inv.lines.reduce((a, l) => a + lineUnder(l), 0);
  if (under > 0) return `${name} is ${money(under, inv.currency)} under the master list.`;
  return `${name}: ${d.title.charAt(0).toLowerCase()}${d.title.slice(1)}.`;
}

/* ------------------------------------------------------------- supplier email ---- */

export interface Email {
  subject: string;
  body: string;
}

/** The message to the supplier about lines priced above the master list. */
export function raiseEmail(inv: SupplierInvoice): Email {
  const no = inv.number ?? inv.fileName;
  const cur = inv.currency ?? "";
  const over = inv.lines.map((line, i) => ({ line, n: i + 1 })).filter((x) => overSheet(x.line));
  const date = invoiceDate(inv.date);
  const ref = [date ? `dated ${date}` : null, inv.purchaseOrder ? `(${inv.purchaseOrder})` : null].filter(Boolean).join(" ");
  const blocks = over.map(({ line, n }) => {
    const head = [`Line ${n}`, line.part, shortDescription(line)].filter(Boolean).join(", ");
    const qty = line.quantity === null ? "Quantity not read" : `${line.quantity.toLocaleString("en-SG")}${line.unit ? " " + line.unit : ""}`;
    const at = line.unitPrice === null ? "" : ` at ${cur} ${unit(line.unitPrice)} each`;
    const agreed = line.sheetPrice === null ? "" : ` Agreed price ${cur} ${unit(line.sheetPrice)}.`;
    const by = line.overcharge != null ? `\nOver by ${money(line.overcharge, cur)} before tax.` : "";
    return `${head}\n${qty}${at}.${agreed}${by}`;
  });
  const body = [
    "Hello,",
    `Invoice ${no}${ref ? " " + ref : ""} charges above our agreed price on ${plural(over.length, "line", "lines")}.`,
    ...blocks,
    "Please send a corrected invoice.",
    "Thank you",
  ].join("\n\n");
  return { subject: `Invoice ${no}: price above agreed rate`, body };
}

export const mailto = (to: string, e: Email) => `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`;

/* ------------------------------------------------------------------- export ---- */

export const EXPORT_COLUMNS = ["Invoice no", "Supplier", "Invoice date", "Currency", "Total", "Decision", "Reason", "Decided at"];

/** CSV of invoices ready to pay (ready_to_pay and ready_to_pay_anyway), oldest decision first. */
export function exportReadyToPay(list: SupplierInvoice[]): string {
  const rows = list
    .filter((inv) => inv.outcome === "ready_to_pay" || inv.outcome === "ready_to_pay_anyway")
    .sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""))
    .map((inv) =>
      [
        csvCell(inv.number ?? inv.fileName),
        csvCell(inv.supplier),
        csvCell(inv.date),
        csvCell(inv.currency),
        inv.total === null ? "" : inv.total.toFixed(2),
        OUTCOME_PILL[inv.outcome!].text,
        csvCell(inv.outcomeReason),
        csvCell(inv.decidedAt, false),
      ].join(","),
    );
  return [EXPORT_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/* --------------------------------------------------------------------- time ---- */

/** "Today, 11:20", "20 Oct, 10:42", "3 Jan 2025, 09:00" in the reader's own time. */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${time}`;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) };
  return `${at.toLocaleDateString("en-GB", opts)}, ${time}`;
}

/** "19 Oct" from the invoice's date, else from the upload time. */
export function shortDate(inv: SupplierInvoice): string {
  const m = inv.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const at = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(inv.uploadedAt);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* --------------------------------------------------------------- audit trail ---- */

export type AuditKind = "ready" | "raised" | "anyway" | "master";

export interface AuditRow {
  key: string;
  kind: AuditKind;
  at: string;
  title: string;
  sub: string;
  pill: Pill;
  details: string;
  invoiceId: string | null;
}

const KIND: Record<Outcome, AuditKind> = { ready_to_pay: "ready", raise_with_supplier: "raised", ready_to_pay_anyway: "anyway" };

/** Decided invoices plus master list uploads, newest first. */
export function auditRows(
  list: SupplierInvoice[],
  events: { kind: "uploaded" | "replaced"; file: string; at: string; items: number; suppliers: number }[],
): AuditRow[] {
  const rows: AuditRow[] = list
    .filter((inv) => inv.outcome && inv.decidedAt)
    .map((inv) => {
      const o = inv.outcome!;
      let details = "";
      if (o === "raise_with_supplier") {
        const n = inv.lines.filter(overSheet).length;
        details = inv.overchargeTotal != null && inv.overchargeTotal > 0 ? `${money(inv.overchargeTotal, inv.currency)} over` : `${plural(n, "line", "lines")} over`;
      } else if (o === "ready_to_pay_anyway" && inv.outcomeReason) details = `“${inv.outcomeReason}”`;
      return { key: inv.id, kind: KIND[o], at: inv.decidedAt!, title: inv.number ?? inv.fileName, sub: inv.supplier ?? "", pill: OUTCOME_PILL[o], details, invoiceId: inv.id };
    });
  for (const e of events)
    rows.push({
      key: `ml-${e.at}`,
      kind: "master",
      at: e.at,
      title: "Master list",
      sub: e.file,
      pill: { text: e.kind === "replaced" ? "Replaced" : "Uploaded", tone: "neutral" },
      details: `${plural(e.items, "item", "items")} · ${plural(e.suppliers, "supplier", "suppliers")}`,
      invoiceId: null,
    });
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
