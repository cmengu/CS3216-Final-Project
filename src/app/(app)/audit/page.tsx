"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { auditRows, exportReadyToPay, whenLabel, type AuditKind } from "@/checker/present";
import { csvName } from "@/checker/review";
import { useApp } from "@/components/AppShell";
import { download, Pill, Search } from "@/components/ui";
import { useProjectEvents } from "@/checker/projects";

const FILTERS: [AuditKind | "all", string][] = [
  ["all", "All decisions"],
  ["ready", "Ready to pay"],
  ["raised", "Raised"],
  ["anyway", "Paid anyway"],
  ["master", "Master list"],
];

const COLS = "150px minmax(0, 1.3fr) 170px minmax(0, 1.6fr) 60px";

export default function Audit() {
  const { invoices, invoiceError, projects } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<AuditKind | "all">("all");
  const [projectId, setProjectId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { events, error: eventsError } = useProjectEvents(projects);
  const rows = useMemo(() => auditRows(invoices ?? [], events), [invoices, events]);
  const ql = q.trim().toLowerCase();
  const selectedProjectId = projects.some((p) => p.id === projectId) ? projectId : projects[0]?.id;
  const invalidDates = !!dateFrom && !!dateTo && dateFrom > dateTo;
  const shown = rows.filter((r) => {
    const at = new Date(r.at);
    const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const end = dateTo ? new Date(`${dateTo}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    return !invalidDates && (filter === "all" || r.kind === filter)
      && r.projectId === selectedProjectId
      && (!start || at >= start) && (!end || at < end)
      && (!ql || `${r.title} ${r.sub} ${r.details}`.toLowerCase().includes(ql));
  });

  return (
    <div className="ic-page">
      {eventsError ? <p role="alert">{eventsError}</p> : null}
      <div className="ic-headrow">
        <h1 className="ic-h1">Audit trail</h1>
        <button type="button" className="ic-btn ic-btn--secondary" onClick={() => download(csvName(), exportReadyToPay(invoices ?? []))} disabled={!invoices}>
          Export ready to pay
        </button>
      </div>
      <div className="ic-controls" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <Search label="Search audit trail" placeholder="Search supplier or invoice number" value={q} onChange={setQ} full />
        </div>
        <label className="ic-field ic-field--strong">Invoice group
          <select className="ic-select" value={selectedProjectId ?? ""} disabled={!projects.length} onChange={(e) => setProjectId(e.target.value)}>
            {!projects.length ? <option value="">No invoice groups</option> : null}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="ic-field ic-field--strong">Decision
          <select className="ic-select" value={filter} onChange={(e) => setFilter(e.target.value as AuditKind | "all")}>
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="ic-field ic-field--strong">From
          <input className="ic-input" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="ic-field ic-field--strong">To
          <input className="ic-input" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>
      {invalidDates ? <p className="ic-hint ic-hint--error" role="alert">The end date must be on or after the start date.</p> : null}
      <section className="ic-card" aria-label="Audit trail" style={{ padding: "8px 24px" }}>
        <div role="table" aria-label="Audit trail">
          <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 16, padding: "10px 0", fontSize: "calc(14.5px * var(--text-scale))", fontWeight: 600, color: "var(--ink)" }}>
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
