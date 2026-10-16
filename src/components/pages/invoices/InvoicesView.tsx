"use client";

/*
 * Invoices: Formal B2B Accounts Payable & Price-Sheet Audit workspace.
 * Separation of Duty modes in the top header (matching /orders):
 *   1. Invoice Ledger (read-only accounting register of all supplier invoices)
 *   2. Audit Queue (focused split-pane workbench to resolve pending invoices in 1 click)
 *   3. Ready to Pay (approved payment run register with 1-click CSV export)
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { decideInvoice, invoiceFileUrl, reloadInvoices, rememberInvoice, retryInvoice, uploadInvoice, uploadProblem, useInvoices } from "@/checker/api";
import { choices, csvName, decidedLabel, disputeNote, OUTCOME, REASON_MAX, readyToPay, readyToPayCsv } from "@/checker/review";
import {
  amount,
  failure,
  invoiceLabel,
  lineOver,
  overcharge,
  problemLines,
  problemsFirst,
  resultLabel,
  sheetName,
  summarize,
  totalKnown,
  unitPrice,
  uploadedLabel,
} from "@/checker/summary";
import type { Outcome, SupplierInvoice } from "@/checker/types";

export type InvoiceDutyMode = "ledger" | "audit" | "payable";
export type LedgerFilter = "all" | "pending" | "overcharged" | "decided";

/** Shown wherever replayed answers are listed, so they are never taken for a real check. */
export const FIXTURE_MARK = "Fixture answers, not a live check";

const MODE_CAPTIONS: Record<InvoiceDutyMode, string> = {
  ledger: "",
  audit: "",
  payable: "",
};

/** Hand the reader a file. Nothing leaves the browser. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const fmtNum = (n: number | null, f: (n: number) => string = amount) => (n === null ? "—" : f(n));

function statusDotClass(inv: SupplierInvoice): string {
  if (inv.state === "failed" || overcharge(inv) > 0) return "b-bad";
  if (inv.state === "checking") return "b-info";
  if (problemLines(inv).length > 0 || !totalKnown(inv)) return "b-warn";
  return "b-good";
}

function auditStatusLabel(inv: SupplierInvoice): string {
  if (inv.state === "failed") return "Check failed";
  if (inv.state === "checking") return "Checking…";
  if (overcharge(inv) > 0) return "Price variance";
  if (problemLines(inv).length > 0 || !totalKnown(inv)) return "Manual check";
  return "Verified match";
}

function auditSummaryText(inv: SupplierInvoice): string {
  if (inv.state === "checking") return "Checking against contract price sheet…";
  if (inv.state === "failed") return failure(inv);
  const mism = inv.lines.filter((l) => l.result === "price_mismatch").length;
  const unkn = inv.lines.filter((l) => l.result === "unknown_part").length;
  const need = inv.lines.filter((l) => l.result === "needs_person").length;
  const parts: string[] = [];
  if (mism > 0) parts.push(`${mism} price ${mism === 1 ? "mismatch" : "mismatches"}`);
  if (unkn > 0) parts.push(`${unkn} unlisted ${unkn === 1 ? "part" : "parts"}`);
  if (need > 0) parts.push(`${need} line ${need === 1 ? "check" : "checks"}`);
  if ((inv.warnings ?? []).length > 0) parts.push("header total warning");
  if (parts.length > 0) return parts.join(" · ");
  return `All ${inv.lines.length} lines match ${sheetName(inv.priceSheet)}`;
}

function decisionDotClass(inv: SupplierInvoice): string {
  if (!inv.outcome) return "b-warn";
  if (inv.outcome === "ready_to_pay") return "b-good";
  if (inv.outcome === "ready_to_pay_anyway") return "b-info";
  return "b-bad";
}

function decisionText(inv: SupplierInvoice): string {
  if (!inv.outcome) return "Pending audit";
  if (inv.outcome === "ready_to_pay") return "Approved to pay";
  if (inv.outcome === "ready_to_pay_anyway") return "Approved (override)";
  return "Disputed w/ supplier";
}

export function InvoicesView() {
  const shell = useShell();
  const router = useRouter();
  const { invoices, error } = useInvoices();

  const [mode, setMode] = useState<InvoiceDutyMode>("ledger");
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
  const [showAllLines, setShowAllLines] = useState(false);

  // Override reason state inside Audit Queue workbench
  const [askingOverride, setAskingOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [formInvoiceId, setFormInvoiceId] = useState<string | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);

  const [sendingName, setSendingName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const sending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const listAll = invoices ?? [];
  const s = summarize(listAll);
  const pendingList = s.piles.decide;
  const decidedList = s.piles.done;
  const payableList = readyToPay(listAll);
  const allOrdered = [...pendingList, ...decidedList];

  // Keep activeAuditId pointed at a valid undecided invoice when in Audit Queue
  const activeAuditInvoice =
    pendingList.find((inv) => inv.id === activeAuditId) ??
    pendingList[0] ??
    null;

  // Reset the form before displaying a different invoice, without an extra effect render.
  const currentInvoiceId = activeAuditInvoice?.id ?? null;
  if (formInvoiceId !== currentInvoiceId) {
    setFormInvoiceId(currentInvoiceId);
    setAskingOverride(false);
    setOverrideReason("");
    setShowAllLines(false);
  }

  // Unique supplier names for the ledger filter
  const suppliers = Array.from(
    new Set(allOrdered.map((inv) => inv.supplier).filter((x): x is string => !!x)),
  ).sort();

  const filteredLedger = allOrdered.filter((inv) => {
    if (supplierFilter && inv.supplier !== supplierFilter) return false;
    if (ledgerFilter === "pending") return !inv.outcome;
    if (ledgerFilter === "overcharged") return overcharge(inv) > 0;
    if (ledgerFilter === "decided") return !!inv.outcome;
    return true;
  });

  // Totals by currency for Ready to Pay
  const payableTotals = new Map<string, number>();
  for (const inv of payableList) {
    if (inv.total !== null) {
      const cur = inv.currency ?? "SGD";
      payableTotals.set(cur, (payableTotals.get(cur) ?? 0) + inv.total);
    }
  }

  const busy = sendingName !== null;

  async function send(files: FileList | null | undefined) {
    const file = files?.[0];
    if (!file || sending.current) return;
    const problem = uploadProblem(file);
    if (problem) {
      shell.toast(problem);
      return;
    }
    if (files.length > 1) shell.toast(`One PDF at a time: checking ${file.name} only.`);
    sending.current = true;
    setSendingName(file.name);
    try {
      const saved = await uploadInvoice(file);
      reloadInvoices();
      router.push(`/invoices/${saved.id}`);
    } catch (reason) {
      shell.toast(reason instanceof Error ? reason.message : "The checking service could not be reached.");
    } finally {
      sending.current = false;
      setSendingName(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleAuditDecision(inv: SupplierInvoice, outcome: Outcome | null, reason: string | null = null) {
    if (savingDecision) return;
    setSavingDecision(true);
    try {
      // Find the next undecided invoice before saving so we can smoothly advance
      const idx = pendingList.findIndex((x) => x.id === inv.id);
      const nextCandidate =
        pendingList[idx + 1] ??
        pendingList[idx - 1] ??
        null;

      const saved = await decideInvoice(inv.id, outcome, reason);
      rememberInvoice(saved);
      setAskingOverride(false);
      setOverrideReason("");

      if (outcome) {
        shell.toast(`${inv.number ?? inv.fileName}: ${OUTCOME[outcome][1]}`);
        if (nextCandidate) setActiveAuditId(nextCandidate.id);
      } else {
        shell.toast(`${inv.number ?? inv.fileName} returned to Audit Queue.`);
      }
    } catch (err) {
      shell.toast(err instanceof Error ? err.message : "Could not save decision.");
    } finally {
      setSavingDecision(false);
    }
  }

  async function handleRetry(inv: SupplierInvoice) {
    if (savingDecision) return;
    setSavingDecision(true);
    try {
      const saved = await retryInvoice(inv);
      reloadInvoices();
      setActiveAuditId(saved.id);
    } catch (err) {
      shell.toast(err instanceof Error ? err.message : "The checking service could not be reached.");
    } finally {
      setSavingDecision(false);
    }
  }

  const statusMsg = busy ? `Checking ${sendingName} against contract price sheet…` : dragging ? "Drop supplier PDF anywhere to audit against contract prices." : "";

  return (
    <>
      <Header
        className="ck-hd"

      >
        <div className="o-duty-switch" role="tablist" aria-label="Invoice workspace mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ledger"}
            className={`o-duty-btn mode-ledger${mode === "ledger" ? " on" : ""}`}
            onClick={() => setMode("ledger")}
          >
            Invoice Ledger
            <span className="cnt">{allOrdered.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "audit"}
            className={`o-duty-btn mode-exceptions${mode === "audit" ? " on" : ""}`}
            onClick={() => setMode("audit")}
          >
            <span className="o-duty-dot warn" />
            Audit Queue
            <span className={`cnt${pendingList.length ? " warn" : ""}`}>{pendingList.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "payable"}
            className={`o-duty-btn mode-dispatch${mode === "payable" ? " on" : ""}`}
            onClick={() => setMode("payable")}
          >
            <span className="o-duty-dot good" />
            Ready to Pay
            <span className={`cnt${payableList.length ? " info" : ""}`}>{payableList.length}</span>
          </button>
        </div>
      </Header>

      <div
        className={`ck-workspace${dragging ? " drag" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void send(event.dataTransfer.files);
        }}
      >
        <section id="upload" className="ck-upload-panel" aria-labelledby="ck-upload-title" aria-busy={busy}>
          <div>
            <h2 id="ck-upload-title">Drag a file here, or</h2>
            <p id="ck-upload-help">Choose a file to upload</p>
          </div>
          <input
            ref={fileInput}
            className="ck-file"
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Invoice PDF"
            disabled={busy}
            hidden
            onChange={(event) => void send(event.target.files)}
          />
          <button
            type="button"
            className="btn p"
            disabled={busy}
            aria-describedby="ck-upload-help"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="arrowUp" />
            {busy ? "Processing PDF…" : "Upload an Invoice PDF"}
          </button>
        </section>
        {mode !== "ledger" ? <p className="ck-mode-caption">{MODE_CAPTIONS[mode]}</p> : null}
        {statusMsg ? (
          <div className="ck-banner-status" role="status">
            {statusMsg}
          </div>
        ) : null}

        {/* ====================================================================
            MODE 1: FORMAL READ-ONLY INVOICE LEDGER
            ==================================================================== */}
        {mode === "ledger" ? (
          <>
            <div className="filt ck-ledger-filters">
              <span className="fw">
                <select value={ledgerFilter} onChange={(event) => setLedgerFilter(event.target.value as LedgerFilter)} aria-label="Filter by invoice status">
                  <option value="all">All invoices ({allOrdered.length})</option>
                  <option value="pending">Pending audit ({pendingList.length})</option>
                  <option value="overcharged">Overcharged ({allOrdered.filter((invoice) => overcharge(invoice) > 0).length})</option>
                  <option value="decided">Audited / Done ({decidedList.length})</option>
                </select>
                <Icon name="chevDown" />
              </span>
              <span className="fw">
                <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} aria-label="Filter by supplier">
                  <option value="">All suppliers</option>
                  {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                </select>
                <Icon name="chevDown" />
              </span>
            </div>

            <div className="body o-ledger-wrap" style={{ paddingTop: 12 }}>
              {error ? (
                <div className="empty ck-empty">
                  <p>{error}</p>
                  <button className="btn" onClick={reloadInvoices}>
                    Try again
                  </button>
                </div>
              ) : !invoices ? (
                <div className="empty">Loading invoices…</div>
              ) : filteredLedger.length === 0 ? (
                <div className="empty">No invoices match this filter.</div>
              ) : (
                <table className="o-ledger ck-ledger">
                  <thead>
                    <tr>
                      <th style={{ width: 135 }}>Invoice No.</th>
                      <th style={{ width: 105 }}>Date</th>
                      <th style={{ width: 230 }}>Supplier</th>
                      <th>Audit Summary</th>
                      <th className="n" style={{ width: 135 }}>Billed Total</th>
                      <th className="n" style={{ width: 130 }}>Overcharge</th>
                      <th style={{ width: 150 }}>Audit Status</th>
                      <th style={{ width: 165 }}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.map((inv) => {
                      const over = overcharge(inv);
                      return (
                        <tr
                          key={inv.id}
                          className="orow"
                          onClick={() => router.push(`/invoices/${inv.id}`)}
                        >
                          <td className="mono o-po">
                            <Link href={`/invoices/${inv.id}`} onClick={(e) => e.stopPropagation()}>
                              {inv.number ?? "Unnumbered"}
                            </Link>
                          </td>
                          <td className="mono o-date">{inv.date ?? uploadedLabel(inv.uploadedAt)}</td>
                          <td className="o-cust">{inv.supplier ?? inv.fileName}</td>
                          <td className="o-note">{auditSummaryText(inv)}</td>
                          <td className="n mono o-amt">
                            {inv.total !== null ? `${inv.currency ?? ""} ${amount(inv.total)}`.trim() : "—"}
                          </td>
                          <td className={`n mono ${over > 0 ? "ck-over-cell" : "o-dash"}`}>
                            {over > 0 ? `+${inv.currency ?? ""} ${amount(over)}`.trim() : totalKnown(inv) ? "—" : "Check line"}
                          </td>
                          <td>
                            <span className="o-status">
                              <span className={`b ${statusDotClass(inv)}`} />
                              {auditStatusLabel(inv)}
                            </span>
                          </td>
                          <td>
                            <span className="o-status">
                              <span className={`b ${decisionDotClass(inv)}`} />
                              <span className={!inv.outcome ? "ck-pending-txt" : ""}>{decisionText(inv)}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}

        {/* ====================================================================
            MODE 2: DEDICATED SPLIT-PANE AUDIT QUEUE (1-Click Fast Triage)
            ==================================================================== */}
        {mode === "audit" ? (
          pendingList.length === 0 ? (
            <div className="body">
              <div className="empty">
                All supplier invoices have been audited. Switch to <b>Invoice Ledger</b> or <b>Ready to Pay</b>.
              </div>
            </div>
          ) : (
            <div className="o-triage">
              {/* Left Queue Rail */}
              <aside className="o-triage-rail" aria-label="Invoices awaiting audit">
                <div className="o-triage-rail-hd">
                  <span>Audit Queue ({pendingList.length})</span>
                  <span>Variance</span>
                </div>
                {pendingList.map((inv) => {
                  const isCur = activeAuditInvoice?.id === inv.id;
                  const over = overcharge(inv);
                  const [, findText] = invoiceLabel(inv);
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      className={`o-triage-item${isCur ? " on" : ""}`}
                      onClick={() => setActiveAuditId(inv.id)}
                    >
                      <div className="o-triage-item-top">
                        <span className="o-triage-po">{inv.supplier ?? inv.fileName}</span>
                        <span className={`lbl ${over > 0 || inv.state === "failed" ? "l-bad" : problemLines(inv).length || !totalKnown(inv) ? "l-warn" : "l-good"}`}>
                          {findText}
                        </span>
                      </div>
                      <div className="o-triage-cust mono" style={{ fontSize: 11.5 }}>
                        {inv.number ?? inv.fileName}
                        {inv.total !== null ? ` · ${inv.currency ?? ""} ${amount(inv.total)}` : ""}
                      </div>
                      <div className="o-triage-meta">
                        <span>{inv.date ?? uploadedLabel(inv.uploadedAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </aside>

              {/* Right Audit Workbench */}
              {activeAuditInvoice ? (
                <div className="o-triage-work">
                  {(() => {
                    const inv = activeAuditInvoice;
                    const c = choices(inv);
                    const over = overcharge(inv);
                    const probs = problemsFirst(inv.lines).filter((l) => l.result !== "match");
                    const displayLines = showAllLines || probs.length === 0 ? inv.lines : probs;
                    const trimmedReason = overrideReason.trim();

                    return (
                      <>
                        {/* Workbench Action Header — Decision Controls at the Top */}
                        <div className="o-work-hd">
                          <div>
                            <div className="o-work-title">
                              <h2>{inv.supplier ?? inv.fileName}</h2>
                              {inv.number ? <span className="mono ck-work-no">{inv.number}</span> : null}
                              <span className={`lbl ${invoiceLabel(inv)[0]}`}>{invoiceLabel(inv)[1]}</span>
                            </div>
                            <div className="o-work-sub">
                              {inv.date ? `Invoice date ${inv.date} · ` : ""}
                              Checked against <b>{sheetName(inv.priceSheet)}</b> · File
                              {" "}
                              <Link href={`/invoices/${inv.id}`} className="o-link-btn">
                                {inv.fileName}↗
                              </Link>
                            </div>
                          </div>

                          {/* Primary 1-Click Audit Actions */}
                          <div className="o-work-acts">
                            {c.pay ? (
                              <button
                                type="button"
                                className="btn good"
                                disabled={savingDecision}
                                onClick={() => void handleAuditDecision(inv, "ready_to_pay")}
                              >
                                <Icon name="check" />
                                Approve for Payment
                              </button>
                            ) : null}
                            {c.raise ? (
                              <button
                                type="button"
                                className="btn bad"
                                disabled={savingDecision}
                                onClick={() => void handleAuditDecision(inv, "raise_with_supplier")}
                              >
                                Dispute with Supplier ({inv.currency ?? ""} {amount(over)} over)
                              </button>
                            ) : null}
                            {c.payAnyway ? (
                              <button
                                type="button"
                                className={`btn${!c.pay && !c.raise ? " p" : ""}`}
                                disabled={savingDecision}
                                onClick={() => setAskingOverride((v) => !v)}
                              >
                                {c.raise ? "Approve Anyway (Override)…" : "Approve After Manual Check…"}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Inline Override Reason Box (when user clicks Approve Anyway / Manual Check) */}
                        {askingOverride ? (
                          <form
                            className="ck-override-bar"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (trimmedReason) void handleAuditDecision(inv, "ready_to_pay_anyway", trimmedReason);
                            }}
                          >
                            <div className="ck-override-top">
                              <b>Audit Override Reason (Required for Payment Run)</b>
                              <span>Explain why this invoice is approved despite the flagged variance</span>
                            </div>
                            <div className="ck-override-row">
                              <input
                                type="text"
                                className="ck-override-inp"
                                maxLength={REASON_MAX}
                                required
                                autoFocus
                                placeholder="e.g., Credit note CN-402 agreed with supplier, or spot-buy surcharge approved by May"
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                              />
                              <button type="submit" className="btn good" disabled={savingDecision || !trimmedReason}>
                                {savingDecision ? "Saving…" : "Confirm Approval"}
                              </button>
                              <button type="button" className="btn" onClick={() => setAskingOverride(false)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : null}

                        <div className="o-work-body">
                          {/* KPI Strip for the Active Invoice */}
                          <div className="ck-summary-strip">
                            <div className="ck-stat-cell">
                              <span className="ck-stat-lbl">Billed Subtotal / Tax</span>
                              <b className="mono">
                                {inv.subtotal !== null ? `${inv.currency ?? ""} ${amount(inv.subtotal)}` : "—"}
                                {inv.tax !== null ? ` + ${amount(inv.tax)} tax` : ""}
                              </b>
                            </div>
                            <div className="ck-stat-cell">
                              <span className="ck-stat-lbl">Billed Total</span>
                              <b className="mono">{inv.total !== null ? `${inv.currency ?? ""} ${amount(inv.total)}` : "—"}</b>
                            </div>
                            <div className={`ck-stat-cell${over > 0 ? " bad" : ""}`}>
                              <span className="ck-stat-lbl">Contract Overcharge</span>
                              <b className="mono">
                                {over > 0 ? `+${inv.currency ?? ""} ${amount(over)}` : totalKnown(inv) ? "None (0.00)" : "Unconfirmed"}
                              </b>
                            </div>
                            <div className="ck-stat-cell">
                              <span className="ck-stat-lbl">Line Audit Status</span>
                              <b>
                                {inv.state === "failed"
                                  ? "PDF Unreadable"
                                  : probs.length > 0
                                    ? `${probs.length} of ${inv.lines.length} lines flagged`
                                    : `All ${inv.lines.length} lines verified`}
                              </b>
                            </div>
                          </div>

                          {/* Warnings if totals don't add up */}
                          {(inv.warnings ?? []).map((w) => (
                            <div key={w} className="ck-warn-strip">
                              <span className="o-notice-dot" />
                              <b>Math / Header Warning:</b> {w}
                            </div>
                          ))}

                          {/* Failed Invoice Panel */}
                          {inv.state === "failed" ? (
                            <div className="o-Resolve-box">
                              <div className="o-Resolve-box-hd">
                                <span>PDF Check Failed — {failure(inv)}</span>
                                <span className="mono">{inv.error ?? "Unknown error"}</span>
                              </div>
                              <div className="o-Resolve-box-body">
                                <p style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: 13 }}>
                                  Nothing on this invoice could be verified automatically. Check the original PDF against the contract price sheet by hand before approving, or re-run the check.
                                </p>
                                <div className="ck-acts">
                                  <button type="button" className="btn p" disabled={savingDecision} onClick={() => void handleRetry(inv)}>
                                    {savingDecision ? "Checking again…" : "Re-run Check"}
                                  </button>
                                  <a className="btn" href={invoiceFileUrl(inv.id)} target="_blank" rel="noreferrer">
                                    Open Original PDF
                                  </a>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Formal Line-Item Price Audit Table */
                            <div className="o-Resolve-box">
                              <div className="o-Resolve-box-hd">
                                <span>
                                  {probs.length > 0 && !showAllLines
                                    ? `Flagged Discrepancies (${probs.length} of ${inv.lines.length} lines)`
                                    : `All Invoice Line Items (${inv.lines.length} lines)`}
                                </span>
                                {probs.length > 0 && probs.length < inv.lines.length ? (
                                  <button
                                    type="button"
                                    className="o-link-btn"
                                    onClick={() => setShowAllLines((v) => !v)}
                                  >
                                    {showAllLines
                                      ? `Show only flagged lines (${probs.length})`
                                      : `Show all ${inv.lines.length} lines (${inv.lines.length - probs.length} matching)`}
                                  </button>
                                ) : null}
                              </div>
                              <div className="o-Resolve-box-body" style={{ padding: "0 16px 8px" }}>
                                <table className="o-ledger ck-line-table">
                                  <thead>
                                    <tr>
                                      <th>Part / Description</th>
                                      <th className="n" style={{ width: 80 }}>Qty</th>
                                      <th className="n" style={{ width: 110 }}>Billed Unit</th>
                                      <th className="n" style={{ width: 110 }}>Contract Unit</th>
                                      <th className="n" style={{ width: 115 }}>Line Total</th>
                                      <th className="n" style={{ width: 125 }}>Overcharge</th>
                                      <th style={{ width: 160 }}>Audit Finding</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {displayLines.map((l, idx) => {
                                      const [lc, lt] = resultLabel(l);
                                      const lOver = lineOver(l);
                                      const under = l.result === "price_mismatch" && l.difference !== null && l.difference < 0;
                                      return (
                                        <tr key={idx} className={l.result !== "match" ? "ck-flagged-row" : ""}>
                                          <td style={{ whiteSpace: "normal" }}>
                                            <div className="mono" style={{ fontWeight: 600, fontSize: 12 }}>
                                              {l.part ?? "No part code"}
                                            </div>
                                            <div style={{ color: "var(--ink2)", fontSize: 12 }}>{l.description}</div>
                                            {l.result !== "match" && l.result !== "unknown_part" && l.reason ? (
                                              <div className="ck-line-reason">{l.reason}</div>
                                            ) : null}
                                          </td>
                                          <td className="n mono">{fmtNum(l.quantity, (n) => n.toLocaleString("en-SG"))}</td>
                                          <td className="n mono" style={{ fontWeight: l.result === "price_mismatch" ? 600 : 400 }}>
                                            {fmtNum(l.unitPrice, unitPrice)}
                                          </td>
                                          <td className="n mono" style={{ color: "var(--ink2)" }}>
                                            {fmtNum(l.sheetPrice, unitPrice)}
                                          </td>
                                          <td className="n mono">{fmtNum(l.lineTotal)}</td>
                                          <td className={`n mono ${lOver > 0 ? "ck-over-cell" : under ? "ck-under-cell" : "o-dash"}`}>
                                            {lOver > 0
                                              ? `+${amount(lOver)}`
                                              : under
                                                ? `-${unitPrice(Math.abs(l.difference!))}/ea`
                                                : l.result === "needs_person"
                                                  ? "?"
                                                  : "—"}
                                          </td>
                                          <td>
                                            <span className={`lbl ${lc}`}>{lt}</span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {/* ====================================================================
            MODE 3: READY TO PAY (Approved Payment Run & CSV Export)
            ==================================================================== */}
        {mode === "payable" ? (
          <>
            <div className="o-batch-bar">
              <div>
                <div className="o-batch-title">
                  Approved Payment Run · {payableList.length} {payableList.length === 1 ? "invoice" : "invoices"} ready to pay
                </div>
                <div className="o-batch-sub">
                  {payableTotals.size > 0
                    ? `Total payable: ${[...payableTotals.entries()].map(([cur, val]) => `${cur} ${amount(val)}`).join(" · ")}`
                    : "Approve invoices in the Audit Queue to include them in the payment export."}
                </div>
              </div>
              <div className="o-batch-acts">
                <button
                  type="button"
                  className="btn good"
                  disabled={payableList.length === 0}
                  onClick={() => download(csvName(), readyToPayCsv(listAll))}
                >
                  <Icon name="check" />
                  Export Payment CSV ({payableList.length})
                </button>
              </div>
            </div>

            <div className="body o-ledger-wrap" style={{ paddingTop: 12 }}>
              {decidedList.length === 0 ? (
                <div className="empty">No invoices have been audited yet.</div>
              ) : (
                <table className="o-ledger ck-ledger">
                  <thead>
                    <tr>
                      <th style={{ width: 135 }}>Invoice No.</th>
                      <th style={{ width: 105 }}>Date</th>
                      <th>Supplier</th>
                      <th className="n" style={{ width: 130 }}>Billed Total</th>
                      <th style={{ width: 175 }}>Audit Outcome</th>
                      <th>Audit Note / Override Reason</th>
                      <th style={{ width: 120 }}>Decided</th>
                      <th className="o-col-act">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decidedList.map((inv) => {
                      const note = inv.outcome === "raise_with_supplier" ? disputeNote(inv) : null;
                      return (
                        <tr
                          key={inv.id}
                          className="orow"
                          onClick={() => router.push(`/invoices/${inv.id}`)}
                        >
                          <td className="mono o-po">
                            <Link href={`/invoices/${inv.id}`} onClick={(e) => e.stopPropagation()}>
                              {inv.number ?? "Unnumbered"}
                            </Link>
                          </td>
                          <td className="mono o-date">{inv.date ?? "—"}</td>
                          <td className="o-cust">{inv.supplier ?? inv.fileName}</td>
                          <td className="n mono o-amt">
                            {inv.total !== null ? `${inv.currency ?? ""} ${amount(inv.total)}`.trim() : "—"}
                          </td>
                          <td>
                            <span className="o-status">
                              <span className={`b ${decisionDotClass(inv)}`} />
                              {decisionText(inv)}
                            </span>
                          </td>
                          <td className="o-note">
                            {inv.outcomeReason ?? (inv.outcome === "raise_with_supplier" ? "Disputed overcharge with supplier" : "Verified against contract sheet")}
                          </td>
                          <td className="mono o-date">{decidedLabel(inv).replace(/^Decided\s+/i, "")}</td>
                          <td className="o-col-act" onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              {note ? (
                                <button
                                  type="button"
                                  className="btn xs"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(note).then(
                                      () => shell.toast("Dispute note copied to clipboard."),
                                      () => shell.toast("Could not copy dispute note."),
                                    );
                                  }}
                                >
                                  Copy Dispute Note
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn xs"
                                disabled={savingDecision}
                                onClick={() => void handleAuditDecision(inv, null)}
                              >
                                Undo
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
