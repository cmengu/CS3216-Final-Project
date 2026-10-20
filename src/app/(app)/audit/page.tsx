"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { auditRows, exportReadyToPay, whenLabel, type AuditKind } from "@/checker/present";
import { csvName } from "@/checker/review";
import { useApp } from "@/components/AppShell";
import { download, Pill, Search } from "@/components/ui";
import { getMasterListEvents } from "@/masterList";

const FILTERS: [AuditKind | "all", string][] = [
  ["all", "All"],
  ["ready", "Ready to pay"],
  ["raised", "Raised"],
  ["anyway", "Paid anyway"],
  ["master", "Master list"],
];

const COLS = "150px minmax(0, 1.3fr) 170px minmax(0, 1.6fr) 60px";

export default function Audit() {
  const { invoices, invoiceError, masterList } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<AuditKind | "all">("all");
  // The events change only when the master list does.
  const events = useMemo(() => (masterList ? getMasterListEvents() : []), [masterList]);
  const rows = useMemo(() => auditRows(invoices ?? [], events), [invoices, events]);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === "all" || r.kind === filter) && (!ql || `${r.title} ${r.sub} ${r.details}`.toLowerCase().includes(ql)));

  return (
    <div className="ic-page">
      <div className="ic-headrow">
        <h1 className="ic-h1">Audit trail</h1>
        <button type="button" className="ic-btn ic-btn--secondary" onClick={() => download(csvName(), exportReadyToPay(invoices ?? []))} disabled={!invoices}>
          Export ready to pay
        </button>
      </div>
      <div className="ic-controls">
        <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <Search label="Search audit trail" placeholder="Search supplier or invoice number" value={q} onChange={setQ} full />
        </div>
        <div className="ic-seg" role="group" aria-label="Show">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <section className="ic-card" aria-label="Audit trail" style={{ padding: "8px 24px" }}>
        <div role="table" aria-label="Audit trail">
          <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 16, padding: "8px 0", fontSize: 13, color: "var(--ink2)" }}>
            <span role="columnheader">When</span>
            <span role="columnheader">Invoice</span>
            <span role="columnheader">Decision</span>
            <span role="columnheader">Details</span>
            <span role="columnheader">By</span>
          </div>
          {invoices === null && !invoiceError ? (
            <p className="ic-empty">Loading…</p>
          ) : !shown.length ? (
            <p className="ic-empty">{rows.length ? "Nothing matches." : "No decisions yet."}</p>
          ) : (
            shown.map((r) => (
              <div key={r.key} role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 16, alignItems: "center", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                <span role="cell" className="num">
                  {whenLabel(r.at)}
                </span>
                <span role="cell" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {r.invoiceId ? (
                    <Link href={`/invoices?id=${r.invoiceId}`} style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>
                      {r.title}
                    </Link>
                  ) : (
                    <b style={{ fontWeight: 600 }}>{r.title}</b>
                  )}
                  <span className="muted">{r.sub}</span>
                </span>
                <span role="cell">
                  <Pill pill={r.pill} />
                </span>
                <span role="cell" style={{ minWidth: 0 }}>
                  {r.details}
                </span>
                <span role="cell" className="muted">
                  {/* TODO(backend): the person who decided, once real auth exists */}
                  You
                </span>
              </div>
            ))
          )}
          {invoiceError && invoices === null ? <p className="ic-hint ic-hint--error">{invoiceError}</p> : null}
        </div>
      </section>
    </div>
  );
}
