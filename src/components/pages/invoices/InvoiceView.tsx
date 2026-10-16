"use client";

/*
 * One supplier invoice (/invoices/[id]):
 * Formal B2B commercial invoice audit view with a top action bar for 1-click decisions,
 * a structured commercial invoice document on the left, and a formal discrepancy breakdown on the right.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { NotFound } from "@/components/shell/Guard";
import { useShell } from "@/components/shell/context";
import { decideInvoice, invoiceFileUrl, rememberInvoice, reloadInvoices, retryInvoice, useInvoices, useRemoteInvoice } from "@/checker/api";
import { choices, decidedLabel, disputeNote, nextToDecide, OUTCOME, overSheet, REASON_MAX } from "@/checker/review";
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
  supersededBy,
  unitPrice,
  uploadedLabel,
} from "@/checker/summary";
import type { InvoiceLine, Outcome, SupplierInvoice } from "@/checker/types";
import { fmtShort } from "@/lib/format";
import { FIXTURE_MARK } from "./InvoicesView";

const num = (n: number | null, f: (n: number) => string = amount) => (n === null ? "—" : f(n));

/** A run of matching lines at least this long folds into one row while the invoice has problems. */
const FOLD_AT = 4;

export function InvoiceView({ id }: { id: string }) {
  const { invoice, error, loading, replace } = useRemoteInvoice(id);

  if (loading)
    return (
      <>
        <Header>
          <Link className="crumb" href="/invoices">
            Invoices
          </Link>
        </Header>
        <div className="body">
          <p className="hint" role="status">
            Loading the invoice…
          </p>
        </div>
      </>
    );
  if (!invoice) return <NotFound hint={error ?? "No invoice with this link. It may have been removed."} />;
  return <Invoice inv={invoice} onSaved={replace} />;
}

type Saved = (saved: SupplierInvoice) => void;

function Invoice({ inv, onSaved }: { inv: SupplierInvoice; onSaved: Saved }) {
  const [cls, text] = invoiceLabel(inv);
  const router = useRouter();
  const { invoices } = useInvoices();
  const next = invoices ? nextToDecide(invoices, inv.id) : null;
  const { setEscape, agentOpen } = useShell();

  useEffect(() => {
    setEscape(() => {
      if (agentOpen) return false;
      const t = document.activeElement;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return false;
      router.push("/invoices");
      return true;
    });
    return () => setEscape(null);
  }, [setEscape, agentOpen, router]);

  return (
    <>
      <title>{`${[inv.supplier ?? inv.fileName, inv.number].filter(Boolean).join(" ")} · Invoice Audit`}</title>
      <Header
        className="ck-hd"
        acts={
          <>
            {inv.fixture ? <span className="lbl l-warn">{FIXTURE_MARK}</span> : null}
            <span className={`lbl ${cls}`}>{text}</span>
            {inv.outcome ? <span className={`lbl ${OUTCOME[inv.outcome][0]}`}>{OUTCOME[inv.outcome][1]}</span> : null}
            {next ? (
              <Link className="btn s" href={`/invoices/${next.id}`}>
                Next Pending ({next.number ?? next.supplier ?? next.fileName}) →
              </Link>
            ) : null}
          </>
        }
      >
        <Link className="crumb" href="/invoices">
          Invoices
        </Link>
        <span className="sep">›</span>
        <span className="ck-name">{inv.supplier ?? inv.fileName}</span>
        {inv.number ? <span className="mono ck-no">{inv.number}</span> : null}
      </Header>

      {/* Top Action Bar for 1-Click Audit Decisions */}
      {inv.state !== "checking" ? <TopDecisionBar inv={inv} onSaved={onSaved} /> : null}

      {inv.state === "checking" ? (
        <Checking inv={inv} />
      ) : inv.state === "failed" ? (
        <Failed inv={inv} />
      ) : (
        <Checked inv={inv} />
      )}
    </>
  );
}

function decideWhy(inv: SupplierInvoice): string {
  if (choices(inv).pay) return "All items match.";
  if (inv.state === "failed") return "PDF could not be read automatically. Verify manually against the contract price sheet before approving.";
  const over = inv.lines.filter(overSheet).length;
  if (over) return `${over} ${over === 1 ? "line is" : "lines are"} billed above the contract price sheet (+${inv.currency ?? ""} ${amount(overcharge(inv))}). Dispute with supplier or record an override reason.`;
  if (problemLines(inv).length) return `${problemLines(inv).length} out of ${inv.lines.length} require manual verification.`;
  return "Header subtotal/tax math could not be confirmed automatically. Verify totals before approving.";
}

function TopDecisionBar({ inv, onSaved }: { inv: SupplierInvoice; onSaved: Saved }) {
  const shell = useShell();
  const { invoices } = useInvoices();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const sending = useRef(false);

  const c = choices(inv);
  const next = invoices ? nextToDecide(invoices, inv.id) : null;
  const note = disputeNote(inv);
  const over = overcharge(inv);
  const trimmed = reason.trim();

  async function save(outcome: Outcome | null, why: string | null = null) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const saved = await decideInvoice(inv.id, outcome, why);
      onSaved(saved);
      rememberInvoice(saved);
      setAsking(false);
      setReason("");
      shell.toast(outcome ? `Saved: ${OUTCOME[outcome][1]}` : "Decision cleared. Returned to Audit Queue.");
    } catch (problem) {
      shell.toast(problem instanceof Error ? problem.message : "The checking service could not be reached.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      shell.toast("Dispute note copied to clipboard.");
    } catch {
      shell.toast("Could not copy automatically.");
    }
  }

  return (
    <section className="ck-top-decide" aria-label="Audit decision">
      <div className="ck-top-decide-main">
        <div className="ck-top-decide-info">
          {inv.outcome ? (
            <>
              <span className={`lbl ${OUTCOME[inv.outcome][0]}`}>{OUTCOME[inv.outcome][1]}</span>
              <span className="ck-top-decide-meta">{decidedLabel(inv)}</span>
              {inv.outcomeReason ? (
                <>
                  <span className="o-notice-sep">·</span>
                  <span className="ck-top-decide-reason">{`Note: "${inv.outcomeReason}"`}</span>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span className={`o-notice-dot${over > 0 || inv.state === "failed" ? " bad" : c.pay ? " good" : ""}`} />
              <b>Pending Audit Decision:</b>
              <span className="ck-top-decide-why">{decideWhy(inv)}</span>
            </>
          )}
        </div>

        <div className="ck-top-decide-acts">
          {inv.outcome ? (
            <>
              {note ? (
                <button type="button" className="btn s" onClick={() => void copy(note)}>
                  Copy Dispute Note
                </button>
              ) : null}
              <button type="button" className="btn s" disabled={busy} onClick={() => void save(null)}>
                {busy ? "Saving…" : "Change Decision"}
              </button>
              {next ? (
                <Link className="btn p s" href={`/invoices/${next.id}`}>
                  Next to Audit: {next.supplier ?? next.fileName} →
                </Link>
              ) : null}
            </>
          ) : (
            <>
              {c.pay ? (
                <button type="button" className="btn good" disabled={busy} onClick={() => void save("ready_to_pay")}>
                  <Icon name="check" />
                  Approve for Payment
                </button>
              ) : null}
              {c.raise ? (
                <button type="button" className="btn bad" disabled={busy} onClick={() => void save("raise_with_supplier")}>
                  Dispute with Supplier ({inv.currency ?? ""} {amount(over)} over)
                </button>
              ) : null}
              {c.payAnyway ? (
                <button
                  type="button"
                  className={`btn${!c.pay && !c.raise ? " p" : ""}`}
                  disabled={busy}
                  onClick={() => setAsking((v) => !v)}
                >
                  {c.raise ? "Approve Anyway (Override)…" : "Approve After Manual Check…"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {asking && !inv.outcome ? (
        <form
          className="ck-override-bar"
          style={{ marginTop: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) void save("ready_to_pay_anyway", trimmed);
          }}
        >
          <div className="ck-override-top">
            <label htmlFor={`ck-reason-${inv.id}`}>
              <b>Audit Override Reason (Required)</b>
            </label>
            <span>Record why this invoice can be paid despite the flagged discrepancy</span>
          </div>
          <div className="ck-override-row">
            <input
              id={`ck-reason-${inv.id}`}
              type="text"
              className="ck-override-inp"
              maxLength={REASON_MAX}
              required
              autoFocus
              placeholder="Credit note agreed with supplier, or checked manually against contract price sheet"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setAsking(false);
              }}
            />
            <button className="btn good" type="submit" disabled={busy || !trimmed}>
              {busy ? "Saving…" : "Confirm Approval"}
            </button>
            <button className="btn" type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Checking({ inv }: { inv: SupplierInvoice }) {
  return (
    <div className="body">
      <section className="ck-panel" role="status">
        <h2>{`Reading ${inv.fileName}`}</h2>
        <p>{`Uploaded ${uploadedLabel(inv.uploadedAt)}. A check can take a minute. This page shows the lines by itself when it is done.`}</p>
      </section>
    </div>
  );
}

function Failed({ inv }: { inv: SupplierInvoice }) {
  const shell = useShell();
  const router = useRouter();
  const { invoices } = useInvoices();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const newer = invoices ? supersededBy(inv, invoices) : null;

  async function again() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const saved = await retryInvoice(inv);
      reloadInvoices();
      router.push(`/invoices/${saved.id}`);
    } catch (reason) {
      shell.toast(reason instanceof Error ? reason.message : "The checking service could not be reached.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="body">
      <div className="o-Resolve-box" style={{ maxWidth: 680 }}>
        <div className="o-Resolve-box-hd">
          <span>PDF Extraction Failed — {failure(inv)}</span>
          <span className="mono">{inv.fileName}</span>
        </div>
        <div className="o-Resolve-box-body">
          <p style={{ margin: "0 0 12px", color: "var(--ink2)", lineHeight: 1.55 }}>
            Nothing on this invoice could be checked automatically. Verify the PDF against the contract price sheet by hand before approving, or re-run the check.
          </p>
          {newer ? (
            <p className="ck-newer" style={{ margin: "0 0 12px" }}>
              {`This PDF was uploaded again ${uploadedLabel(newer.uploadedAt)}. `}
              <Link href={`/invoices/${newer.id}`}>Open the newer check →</Link>
            </p>
          ) : null}
          <div className="ck-acts">
            <button className="btn p" disabled={busy} onClick={() => void again()}>
              {busy ? "Checking again…" : "Re-run Check"}
            </button>
            <a className="btn" href={invoiceFileUrl(inv.id)} target="_blank" rel="noreferrer">
              Open Original PDF
            </a>
          </div>
          <details className="ck-details">
            <summary>Diagnostic log from checking service</summary>
            <dl>
              <dt>File</dt>
              <dd className="mono">{inv.fileName}</dd>
              <dt>Uploaded</dt>
              <dd>{uploadedLabel(inv.uploadedAt)}</dd>
              <dt>Service Error</dt>
              <dd className="mono">{inv.error ?? "None given"}</dd>
            </dl>
          </details>
        </div>
      </div>
    </div>
  );
}

type Row = { kind: "line"; line: InvoiceLine; index: number } | { kind: "fold"; start: number; lines: number };

function rowsOf(lines: InvoiceLine[], fold: boolean): Row[] {
  const rows: Row[] = [];
  let run: number[] = [];
  const flush = () => {
    if (fold && run.length >= FOLD_AT) rows.push({ kind: "fold", start: run[0], lines: run.length });
    else for (const i of run) rows.push({ kind: "line", line: lines[i], index: i });
    run = [];
  };
  lines.forEach((l, i) => {
    if (l.result === "match") run.push(i);
    else {
      flush();
      rows.push({ kind: "line", line: l, index: i });
    }
  });
  flush();
  return rows;
}

function Checked({ inv }: { inv: SupplierInvoice }) {
  const shell = useShell();
  const problems = problemsFirst(inv.lines).filter((l) => l.result !== "match");
  const [showAll, setShowAll] = useState(false);
  const matching = inv.lines.length - problems.length;
  const rows = rowsOf(inv.lines, problems.length > 0 && !showAll);
  const note = disputeNote(inv);

  return (
    <div className="ck-invoice-detail">
      {/* Left: Formal Commercial Invoice Document */}
      <section className="ck-pagewrap" aria-label="Commercial invoice document">
        <div className="ck-doc">
          <div className="ck-doc-hd">
            <div>
              <div className="ck-doc-tag">Supplier Tax Invoice (Extracted)</div>
              <h2 className="ck-doc-supplier">{inv.supplier ?? inv.fileName}</h2>
              <div className="ck-doc-meta">
                Source PDF: <a className="mono" href={invoiceFileUrl(inv.id)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{inv.fileName}</a> · Audited against <b>{sheetName(inv.priceSheet)}</b>
              </div>
            </div>
            <div className="ck-doc-meta-grid">
              <div>
                <span>Invoice No.</span>
                <b className="mono">{inv.number ?? "Unnumbered"}</b>
              </div>
              <div>
                <span>Invoice Date</span>
                <b className="mono">{inv.date ? `${fmtShort(inv.date)} ${inv.date.slice(0, 4)}` : "Not read"}</b>
              </div>
              <div>
                <span>Currency</span>
                <b className="mono">{inv.currency ?? "SGD"}</b>
              </div>
            </div>
          </div>

          <div className="ck-scroll">
            <table className="ck-doc-table">
              <thead>
                <tr>
                  <th>Part Code / Description</th>
                  <th className="r" style={{ width: 72 }}>Qty</th>
                  <th className="r" style={{ width: 100 }}>Billed Unit</th>
                  <th className="r" style={{ width: 100 }}>Sheet Unit</th>
                  <th className="r" style={{ width: 105 }}>Variance</th>
                  <th className="r" style={{ width: 110 }}>Line Amount</th>
                  <th>Audit Finding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if (row.kind === "fold")
                    return (
                      <tr key={`f${row.start}`} className="ck-fold">
                        <td colSpan={7}>
                          <button type="button" onClick={() => setShowAll(true)}>
                            + Expand {row.lines} matching contract lines
                          </button>
                        </td>
                      </tr>
                    );
                  const l = row.line;
                  const flagged = l.result !== "match";
                  const [findingClass, findingText] = resultLabel(l);
                  const lOver = lineOver(l);
                  const under = l.result === "price_mismatch" && l.difference !== null && l.difference < 0;
                  return (
                    <tr
                      key={row.index}
                      id={`ck-line-${row.index}`}
                      className={flagged ? `ck-${l.result}` : undefined}
                    >
                      <td>
                        <div className="mono ck-code" style={{ fontWeight: 600 }}>{l.part ?? "—"}</div>
                        <div className="ck-desc">{l.description}</div>
                      </td>
                      <td className="r mono">{num(l.quantity, (n) => n.toLocaleString("en-SG"))}</td>
                      <td className="r mono" style={{ fontWeight: flagged ? 600 : 400 }}>{num(l.unitPrice, unitPrice)}</td>
                      <td className="r mono" style={{ color: "var(--ink2)" }}>{num(l.sheetPrice, unitPrice)}</td>
                      <td className={`r mono ${lOver > 0 ? "ck-over-cell" : under ? "ck-under-cell" : ""}`}>
                        {lOver > 0
                          ? `+${amount(lOver)}`
                          : under
                            ? `-${unitPrice(Math.abs(l.difference!))}/ea`
                            : l.result === "needs_person"
                              ? "?"
                              : "—"}
                      </td>
                      <td className="r mono">{num(l.lineTotal)}</td>
                      <td className="ck-finding-cell">
                        <span className={`lbl ${findingClass}`}>{findingText}</span>
                        {flagged && l.result !== "unknown_part" && l.reason ? <div className="ck-prob-reason">{l.reason}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {showAll && problems.length && matching >= FOLD_AT ? (
            <button type="button" className="ck-foldall" onClick={() => setShowAll(false)}>
              Collapse {matching} matching lines
            </button>
          ) : null}

          <div className="ck-doc-ft">
            <div className="ck-totals">
              <span>Subtotal</span>
              <span className="mono">{num(inv.subtotal)}</span>
              <span>Tax / GST</span>
              <span className="mono">{num(inv.tax)}</span>
              {overcharge(inv) > 0 ? (
                <>
                  <span style={{ color: "var(--bad)", fontWeight: 600 }}>Detected Overcharge</span>
                  <span className="mono" style={{ color: "var(--bad)", fontWeight: 600 }}>
                    +{inv.currency ?? ""} {amount(overcharge(inv))}
                  </span>
                </>
              ) : null}
              <b className="ck-tot-lbl">{`Billed Total (${inv.currency ?? "SGD"})`}</b>
              <b className="mono ck-tot-val">{num(inv.total)}</b>
            </div>
          </div>
        </div>
        {(inv.warnings ?? []).map((warning) => (
          <div className="ck-warn-strip" key={warning}>
            <span className="o-notice-dot" />
            <span>{warning}</span>
          </div>
        ))}

        {/* Ready-to-Send Supplier Dispute Note (shown whenever overcharges exist) */}
        {note ? (
          <div className="ck-side-box">
            <div className="ck-side-hd">
              <b>Supplier Dispute Note</b>
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
                Copy Text
              </button>
            </div>
            <div className="ck-side-body">
              <pre className="ck-dispute-pre" tabIndex={0} aria-label="Dispute note">
                {note}
              </pre>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
