"use client";

import { useState } from "react";
import { decideInvoice, rememberInvoice, retryInvoice } from "@/checker/api";
import {
  checkPill,
  decision,
  failureSentence,
  lineAttention,
  lineDelta,
  LINE_PILL,
  linesPill,
  money,
  OUTCOME_PILL,
  orderedLines,
  raiseEmail,
  statusPill,
  taxLabel,
  unit,
  whenLabel,
} from "@/checker/present";
import { invoiceDate } from "@/checker/review";
import type { Outcome, SupplierInvoice } from "@/checker/types";
import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui";
import type { MasterList } from "@/masterList";
import { CompareDrawer, PayAnywayDialog, RaiseDialog } from "./Dialogs";

async function decide(inv: SupplierInvoice, outcome: Outcome | null, reason: string | null = null): Promise<string | null> {
  try {
    rememberInvoice(await decideInvoice(inv.id, outcome, reason));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "The decision couldn’t be saved.";
  }
}

function DecisionBar({ inv, onPayAnyway, onRaise }: { inv: SupplierInvoice; onPayAnyway: () => void; onRaise: () => void }) {
  const d = decision(inv);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = async (outcome: Outcome | null) => {
    setBusy(true);
    setError(null);
    setError(await decide(inv, outcome));
    setBusy(false);
  };
  return (
    <div className="ic-decide" aria-label="Decision" role="region">
      {d.mode === "decided" && inv.outcome ? (
        <>
          <div className="sum" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pill pill={OUTCOME_PILL[inv.outcome]} />
            <span className="muted">{whenLabel(inv.decidedAt)}</span>
          </div>
          {inv.outcome === "raise_with_supplier" ? (
            <button
              type="button"
              className="ic-btn ic-btn--secondary"
              onClick={async () => {
                const e = raiseEmail(inv);
                try {
                  await navigator.clipboard.writeText(`Subject: ${e.subject}\n\n${e.body}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError("The email couldn’t be copied.");
                }
              }}
            >
              <Icon name="copy" size="ui" />
              {copied ? "Copied" : "Copy email"}
            </button>
          ) : null}
          <button type="button" className="ic-btn ic-btn--ghost" disabled={busy} onClick={() => void run(null)}>
            <Icon name="undo" size="ui" />
            Undo
          </button>
        </>
      ) : (
        <>
          <div className="sum">
            {d.mode === "pay" ? (
              <span className="ic-ok" style={{ color: "var(--ink)", fontWeight: 600 }}>
                <Icon name="tick" />
                {d.title}
              </span>
            ) : (
              <b>{d.title}</b>
            )}
            {d.sub ? <span className="muted">{d.sub}</span> : null}
          </div>
          {d.mode === "raise" || d.mode === "anyway" ? (
            <button type="button" className="ic-btn ic-btn--secondary" onClick={onPayAnyway}>
              Pay anyway…
            </button>
          ) : null}
          {d.mode === "raise" ? (
            <button type="button" className="ic-btn ic-btn--primary" onClick={onRaise}>
              <Icon name="envelope" size="ui" />
              Raise with supplier
            </button>
          ) : null}
          {d.mode === "pay" ? (
            <button type="button" className="ic-btn ic-btn--primary" disabled={busy} onClick={() => void run("ready_to_pay")}>
              Ready to pay
            </button>
          ) : null}
        </>
      )}
      {error ? (
        <p className="ic-hint ic-hint--error" role="alert" style={{ flexBasis: "100%" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Failed({ inv }: { inv: SupplierInvoice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="ic-card ic-card--tight" aria-labelledby="fail-h">
      <div className="ic-card-h">
        <h2 id="fail-h">Couldn’t read this invoice</h2>
      </div>
      <p style={{ margin: "0 0 12px" }}>{failureSentence(inv)}</p>
      <button
        type="button"
        className="ic-btn ic-btn--secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            rememberInvoice(await retryInvoice(inv));
          } catch (e) {
            setError(e instanceof Error ? e.message : "It couldn’t be tried again.");
          }
          setBusy(false);
        }}
      >
        {busy ? "Trying again…" : "Try again"}
      </button>
      {error ? (
        <p className="ic-hint ic-hint--error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CheckPane({
  inv,
  masterList,
  activeLine,
  onShow,
}: {
  inv: SupplierInvoice;
  masterList: MasterList | null;
  activeLine: number | null;
  onShow: (n: number) => void;
}) {
  const [dialog, setDialog] = useState<"pay" | "raise" | "compare" | null>(null);
  const cur = inv.currency;
  const failed = inv.state === "failed";
  const pill = linesPill(inv);
  const meta = failed
    ? [`Uploaded ${whenLabel(inv.uploadedAt)}`, inv.pageCount ? `${inv.pageCount} page${inv.pageCount === 1 ? "" : "s"}` : null]
    : [inv.number, invoiceDate(inv.date), inv.purchaseOrder];

  return (
    <section className="ic-check" aria-label="Check">
      <div className="ic-check-body">
        <div className="ic-titleblock">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="ic-h1 ic-h1--pane">{failed ? inv.fileName : (inv.supplier ?? inv.fileName)}</h1>
            <Pill pill={inv.outcome ? statusPill(inv) : checkPill(inv)} />
          </div>
          <span className="muted" style={{ fontSize: 14 }}>
            {meta.filter(Boolean).join(" · ")}
          </span>
        </div>

        {failed ? (
          <Failed inv={inv} />
        ) : inv.state === "checking" ? (
          <section className="ic-card ic-card--tight">
            <p className="muted" style={{ margin: 0 }}>
              Checking… Each invoice takes up to a minute.
            </p>
          </section>
        ) : (
          <>
            <section className="ic-card ic-card--tight" aria-labelledby="ln-h">
              <div className="ic-card-h">
                <h2 id="ln-h">Lines</h2>
                {pill ? <Pill pill={pill} /> : null}
                <button type="button" className="ic-btn ic-btn--secondary ic-btn--sm end" onClick={() => setDialog("compare")}>
                  <Icon name="compare" size="ui" />
                  Compare
                </button>
              </div>
              {inv.lines.length ? (
                <div role="list" aria-label="Invoice lines">
                  {orderedLines(inv).map(({ line, n }) => {
                    const flagged = line.result !== "match";
                    const delta = lineDelta(line, cur);
                    const quantityUnit = line.unit?.toUpperCase() === "M3" ? "m³" : line.unit;
                    const qty = line.quantity === null ? null : `${line.quantity.toLocaleString("en-SG")}${quantityUnit ? " " + quantityUnit : ""}`;
                    const priceUnit = quantityUnit ? ` / ${quantityUnit}` : "";
                    const comparedCurrency = line.result === "match" || line.result === "price_mismatch" ? cur : null;
                    const price = line.unitPrice === null ? "—" : `${comparedCurrency ? comparedCurrency + " " : ""}${unit(line.unitPrice)}${priceUnit}`;
                    const total = line.lineTotal === null ? "—" : money(line.lineTotal, cur);
                    return (
                      <div className="ic-line" role="listitem" key={n} aria-current={activeLine === n ? "true" : undefined}>
                        {flagged ? (
                          <span style={{ color: "var(--warn)" }}>
                            <Icon name="warn" size="row" style={{ color: "var(--warn)" }} />
                          </span>
                        ) : (
                          <span>
                            <Icon name="tick" size="row" style={{ color: "var(--good)", strokeWidth: 2 }} />
                          </span>
                        )}
                        <div className="ic-line-content">
                          <span className="ic-line-title">
                            {n}. {line.description.trim() || line.part || "No description"}
                          </span>
                          {flagged && line.part ? (
                            <span className="ic-line-code">
                              {line.part}
                            </span>
                          ) : null}
                          {flagged ? <span className="ic-attn">{lineAttention(line, cur)}</span> : null}
                          <div className="cmp">
                            {flagged ? (
                              <>
                                {line.unitPrice !== null ? (
                                  <span>
                                    Invoice unit price: <b>{price}</b>
                                  </span>
                                ) : null}
                                {line.sheetPrice !== null ? (
                                  <span>
                                    Master unit price: <b>{cur ? cur + " " : ""}{unit(line.sheetPrice)}{priceUnit}</b>
                                  </span>
                                ) : null}
                                {qty ? <span>Qty: <b>{qty}</b></span> : null}
                                <span>Total: <b>{total}</b></span>
                                {delta ? (
                                  <span>
                                    <b style={{ color: "var(--warn)" }}>{delta}</b>
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <>
                                {qty ? <span>Qty: <b>{qty}</b></span> : null}
                                <span>Unit price: <b>{price}</b></span>
                                <span>Total: <b>{total}</b></span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="end">
                          <Pill pill={LINE_PILL[line.result]} />
                          {flagged ? (
                            <button type="button" className="ic-link ic-link--sm" onClick={() => onShow(n)} aria-label={`Show line ${n} on the PDF`}>
                              Show
                              <Icon name="arrowR" arrow />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="ic-empty">No lines were found on this invoice.</p>
              )}
            </section>

            <section className="ic-card ic-card--tight" aria-labelledby="tt-h">
              <div className="ic-card-h">
                <h2 id="tt-h">Totals</h2>
              </div>
              <div className="ic-sum">
                <span className="muted" style={{ fontSize: 14 }}>
                  Subtotal
                </span>
                <span className="num" style={{ textAlign: "right" }}>
                  {inv.subtotal === null ? "—" : money(inv.subtotal, null)}
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {taxLabel(inv.taxRate)}
                </span>
                <span className="num" style={{ textAlign: "right" }}>
                  {inv.tax === null ? "—" : money(inv.tax, null)}
                </span>
                <span className="t">Total</span>
                <span className="num t" style={{ textAlign: "right" }}>
                  {inv.total === null ? "—" : money(inv.total, cur)}
                </span>
              </div>
            </section>
          </>
        )}
      </div>

      <DecisionBar inv={inv} onPayAnyway={() => setDialog("pay")} onRaise={() => setDialog("raise")} />

      <PayAnywayDialog inv={inv} open={dialog === "pay"} onClose={() => setDialog(null)} onSubmit={(reason) => decide(inv, "ready_to_pay_anyway", reason)} />
      <RaiseDialog inv={inv} open={dialog === "raise"} onClose={() => setDialog(null)} onRecord={() => decide(inv, "raise_with_supplier")} />
      <CompareDrawer inv={inv} open={dialog === "compare"} onClose={() => setDialog(null)} masterList={masterList} />
    </section>
  );
}

export function AllDecided({ count, onUpload, onExport }: { count: number; onUpload: () => void; onExport: () => void }) {
  return (
    <section className="ic-check" aria-label="Check">
      <div className="ic-check-center">
        <h2>All invoices decided</h2>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          {count} invoice{count === 1 ? "" : "s"} decided
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ic-btn ic-btn--primary" onClick={onUpload}>
            <Icon name="upload" size="ui" />
            Upload invoice
          </button>
          <button type="button" className="ic-btn ic-btn--secondary" onClick={onExport}>
            Export ready to pay
          </button>
        </div>
      </div>
    </section>
  );
}
