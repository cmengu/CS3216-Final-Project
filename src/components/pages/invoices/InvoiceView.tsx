"use client";

/*
 * One supplier invoice: the invoice as it was read on the left, with the problem lines marked
 * A, B, C…, and those lines on the right with both prices, the difference and the reason.
 * Picking a line on either side highlights it on both.
 */
import Link from "next/link";
import { useState } from "react";
import { Header } from "@/components/shell/Header";
import { NotFound } from "@/components/shell/Guard";
import { useInvoices, useRemoteInvoice } from "@/checker/api";
import { amount, invoiceLabel, lineOver, problemsFirst, RESULT, unitPrice } from "@/checker/summary";
import type { InvoiceLine, SupplierInvoice } from "@/checker/types";
import { fmtShort } from "@/lib/format";

const num = (n: number | null, f: (n: number) => string = amount) => (n === null ? "—" : f(n));

export function InvoiceView({ id }: { id: string }) {
  const listed = useInvoices();
  const remote = useRemoteInvoice(id);
  const fromList = listed.invoices?.find((invoice) => invoice.id === id) ?? null;
  const inv = remote.invoice ?? fromList;

  if (!inv && (remote.loading || listed.invoices === null)) return <Header>Invoices</Header>;
  if (!inv) return <NotFound hint={remote.error ?? listed.error ?? "No invoice with this link. It may have been removed."} />;
  return <Checked inv={inv} />;
}

function Checked({ inv }: { inv: SupplierInvoice }) {
  const [cls, text] = invoiceLabel(inv);
  const problems = problemsFirst(inv.lines).filter((l) => l.result !== "match");
  const mark = new Map<InvoiceLine, string>(problems.map((l, i) => [l, String.fromCharCode(65 + i)]));
  const [picked, setPicked] = useState<InvoiceLine | null>(problems[0] ?? null);

  return (
    <>
      <Header acts={inv.state === "checked" ? <span className={`lbl ${cls}`}>{text}</span> : null}>
        <Link className="crumb" href="/invoices">
          Invoices
        </Link>
        <span className="sep">›</span>
        <span className="ck-name">{inv.supplier ?? inv.fileName}</span>
        {inv.number ? <span className="mono ck-no">{inv.number}</span> : null}
      </Header>

      {inv.state !== "checked" ? (
        <div className="body">
          <div className="hint">
            {inv.state === "checking"
              ? `Still reading ${inv.fileName}. Its lines show here once the check is done.`
              : `${inv.fileName} could not be read. Open the PDF and check it by hand.`}
          </div>
        </div>
      ) : (
        <div className="ck-split">
          <section className="ck-pagewrap" aria-label="The invoice as read">
            <div className="hint">
              {`Read from ${inv.fileName} · checked against ${inv.priceSheet ?? "the price sheet"}`}
              {inv.fixture ? " · Fixture answers, not a live check" : ""}
            </div>
            <div className="ck-page">
              <div className="ck-pagehd">
                <b>{inv.supplier}</b>
                <span>
                  {`No. ${inv.number ?? "—"}`}
                  <br />
                  {inv.date ? `Date ${fmtShort(inv.date)}` : ""}
                </span>
              </div>
              <div className="ck-scroll">
                <table>
                  <thead>
                    <tr>
                      <th aria-label="Mark" />
                      <th>Item code</th>
                      <th>Description</th>
                      <th className="r">Qty</th>
                      <th className="r">Unit price</th>
                      <th className="r">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l, i) => {
                      const m = mark.get(l);
                      return (
                        <tr
                          key={i}
                          className={`${m ? "ck-" + l.result : ""}${picked === l ? " cur" : ""}`}
                          onClick={m ? () => setPicked(l) : undefined}
                        >
                          <td className="ck-m">{m ?? ""}</td>
                          <td>{l.part ?? "—"}</td>
                          <td>{l.description}</td>
                          <td className="r">{num(l.quantity, (n) => n.toLocaleString("en-SG"))}</td>
                          <td className="r">{num(l.unitPrice, unitPrice)}</td>
                          <td className="r">{num(l.lineTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="ck-totals">
                <span>Subtotal</span>
                <span>{num(inv.subtotal)}</span>
                <span>Tax</span>
                <span>{num(inv.tax)}</span>
                <b>{`Total ${inv.currency ?? ""}`}</b>
                <b>{num(inv.total)}</b>
              </div>
            </div>
          </section>

          <aside className="ck-side" aria-label="Lines that need a look">
            <div className="ck-sidehd">
              <b>{problems.length ? `${problems.length} ${problems.length > 1 ? "lines need" : "line needs"} a look` : "Every line matches"}</b>
              <span className="hint">{`${inv.lines.length - problems.length} match`}</span>
            </div>
            {problems.map((l) => {
              const [lc, lt] = RESULT[l.result];
              const over = lineOver(l);
              return (
                <button key={mark.get(l)} className={`ck-card${picked === l ? " cur" : ""}`} aria-pressed={picked === l} onClick={() => setPicked(l)}>
                  <span className="ck-cardhd">
                    <span className={`ck-dot ck-${l.result}`}>{mark.get(l)}</span>
                    <span className="mono">{l.part ?? "No part number"}</span>
                    <span className={`lbl ${lc}`}>{lt}</span>
                  </span>
                  <span className="ck-prices">
                    <span>
                      <small>Invoice</small>
                      {num(l.unitPrice, unitPrice)}
                    </span>
                    <span>
                      <small>Sheet</small>
                      {num(l.sheetPrice, unitPrice)}
                    </span>
                    <span>
                      <small>Over by</small>
                      <b>{over > 0 ? `+${amount(over)}` : l.result === "needs_person" ? "?" : "—"}</b>
                    </span>
                  </span>
                  <span className="ck-reason">{l.reason}</span>
                </button>
              );
            })}
          </aside>
        </div>
      )}
    </>
  );
}
