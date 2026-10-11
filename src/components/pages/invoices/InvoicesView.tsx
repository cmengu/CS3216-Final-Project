"use client";

/*
 * Invoices: supplier invoices checked against the price sheet. Totals on top (overcharge found,
 * and one box per pile that also filters the list), then that pile's invoices, newest first.
 * Opening an invoice shows its page beside the lines that need a look. Owner and Finance only.
 */
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { useInvoices } from "@/checker/api";
import { amount, invoiceLabel, invoiceMeta, summarize, type Pile } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { relDay } from "@/lib/format";
import { SupplierMark } from "./SupplierMark";

const PILES: { key: Pile; label: string; empty: string }[] = [
  { key: "look", label: "Needs a look", empty: "Nothing needs a look." },
  { key: "checking", label: "Checking", empty: "Nothing is being checked." },
  { key: "match", label: "All match", empty: "No invoice has passed yet." },
];

const shortName = (inv: SupplierInvoice) => (inv.supplier ?? inv.fileName).replace(/\s+(Pte|Ltd|Supply|Electronics|Components|Passives)\b.*$/, "");

/** "Today 10:42", "Yesterday", "25 Sept". */
function uploaded(inv: SupplierInvoice): string {
  const day = relDay(inv.uploadedAt.slice(0, 10));
  return day === "Today" ? `Today ${inv.uploadedAt.slice(11, 16)}` : day;
}

export function InvoicesView() {
  const shell = useShell();
  const { invoices, error } = useInvoices();
  const [pile, setPile] = useState<Pile>("look");

  const s = summarize(invoices ?? []);
  const list = s.piles[pile];
  const current = PILES.find((p) => p.key === pile)!;

  return (
    <>
      <Header
        icon="inv"
        acts={
          <button className="btn p" onClick={() => shell.toast("Uploading needs the checking service, which is not connected yet")}>
            <Icon name="arrowUp" />
            Upload PDF
          </button>
        }
      >
        Invoices
      </Header>
      <div className="body ck-list">
        <div className="ck-boxes">
          <div className="ck-box over">
            <span>Overcharged so far</span>
            <b className="num">{!invoices ? "–" : s.over.length ? s.over.map(([cur, n]) => `${cur} ${amount(n)}`).join(" · ") : "None found"}</b>
            <small>{!invoices ? "…" : s.overInvoices ? `across ${s.overInvoices} invoice${s.overInvoices > 1 ? "s" : ""}` : "every price matched so far"}</small>
          </div>
          {PILES.map((p) => {
            const n = s.piles[p.key];
            return (
              <button key={p.key} className={`ck-box${pile === p.key ? " on" : ""}`} aria-pressed={pile === p.key} onClick={() => setPile(p.key)}>
                <span>{p.label}</span>
                <b className="num">{invoices ? n.length : "–"}</b>
                <small>{n.length ? n.slice(0, 3).map(shortName).join(", ") + (n.length > 3 ? ` and ${n.length - 3} more` : "") : "none"}</small>
              </button>
            );
          })}
        </div>

        <section aria-label={current.label}>
          <div className="gh ck-gh">{`${current.label} · newest first`}</div>
          {error ? (
            <div className="empty">{error}</div>
          ) : !invoices ? (
            <div className="empty">Loading invoices…</div>
          ) : list.length ? (
            list.map((inv) => {
              const [cls, text] = invoiceLabel(inv);
              return (
                <Link className="row ck-row" href={`/invoices/${inv.id}`} key={inv.id}>
                  <span className="who">
                    <SupplierMark name={inv.supplier} />
                    <b>{inv.supplier ?? inv.fileName}</b>
                  </span>
                  <span className={`lbl ${cls}`}>{text}</span>
                  <span className="sub">
                    {inv.number ? <b className="mono">{inv.number}</b> : null}
                    {invoiceMeta(inv)}
                  </span>
                  <span className="when">{uploaded(inv)}</span>
                </Link>
              );
            })
          ) : (
            <div className="empty">{current.empty}</div>
          )}
        </section>
      </div>
    </>
  );
}
