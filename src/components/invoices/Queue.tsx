"use client";

import Link from "next/link";
import { useState } from "react";
import type { Project } from "@/checker/projects";
import { CreateProject } from "./CreateProject";
import { OUTCOME_PILL, queueAttention, shortDate, statusPill, whenLabel } from "@/checker/present";
import type { SupplierInvoice } from "@/checker/types";
import { dismissNotice, resetUploadsSession, resumeUploads, type QueueItem, type UploadNotice } from "@/checker/uploads";
import { Icon } from "@/components/icons";
import { Notice, Pill, Search } from "@/components/ui";

function Card({ inv, current, done }: { inv: SupplierInvoice; current: boolean; done: boolean }) {
  const attn = done ? null : queueAttention(inv);
  const pill = statusPill(inv);
  return (
    <Link className="ic-qcard" href={`/invoices?project=${encodeURIComponent(inv.projectId ?? "")}&id=${inv.id}`} aria-current={current ? "true" : undefined} scroll={false}>
      <span className="r1">
        <b>{inv.supplier ?? inv.fileName}</b>
        <span className="muted num" style={{ whiteSpace: "nowrap" }}>
          {shortDate(inv)}
        </span>
      </span>
      <span className="r2 muted">
        <span>{inv.number ?? (inv.supplier ? inv.fileName : "")}</span>
      </span>
      <span className="r3">
        {done && inv.outcome ? (
          <>
            <Pill pill={OUTCOME_PILL[inv.outcome]} />
            <span className="muted">{whenLabel(inv.decidedAt)}</span>
          </>
        ) : (
          <>
            <Pill pill={pill} />
            {attn ? <span className={`ic-attn${pill.tone === "bad" || pill.tone === "info" ? ` ic-attn--${pill.tone}` : ""}`}>{attn}</span> : null}
          </>
        )}
      </span>
    </Link>
  );
}

export function Queue({
  decideList,
  doneList,
  q,
  onQ,
  selected,
  uploads,
  notices,
  onUpload,
  onOutlook,
  loadError,
  onRetryLoad,
  onCollapse,
  projects,
  activeProject,
  onProject,
  onBack,
  canUpload,
}: {
  projects: Project[];
  activeProject: string | null;
  onProject: (id: string) => void;
  onBack: () => void;
  canUpload: boolean;
  decideList: SupplierInvoice[];
  doneList: SupplierInvoice[];
  q: string;
  onQ: (q: string) => void;
  selected: string | null;
  uploads: QueueItem[];
  notices: UploadNotice[];
  onUpload: () => void;
  onOutlook?: () => void;
  loadError: string | null;
  onRetryLoad: () => void;
  onCollapse?: () => void;
}) {
  const [segment, setSegment] = useState<"decide" | "done">("decide");
  const project = projects.find((p) => p.id === activeProject);
  const ql = q.trim().toLowerCase();
  const match = (inv: SupplierInvoice) => !ql || [inv.supplier, inv.number, inv.fileName, inv.purchaseOrder].join(" ").toLowerCase().includes(ql);
  const projectDecide = decideList.filter((inv) => inv.projectId === activeProject);
  const projectDone = doneList.filter((inv) => inv.projectId === activeProject);
  const totalsOnly = project?.comparison_mode === "totals_only";
  const list = (totalsOnly ? [...projectDecide, ...projectDone] : segment === "decide" ? projectDecide : projectDone).filter(match);
  const projectUploads = uploads.filter(item => item.projectId === activeProject);
  const current = projectUploads.find(item => item.status !== "waiting") ?? projectUploads[0];
  return (
    <aside id="invoice-sidebar" className="ic-queue" aria-label="Invoices">
      <div className="ic-queue-h">
        <div className="ic-queue-title">
          <div className="ic-project-location">{project ? <button type="button" className="ic-project-back" onClick={onBack} aria-label="Back to invoice groups"><Icon name="chevL" />Invoice groups</button> : null}<h1>{project?.name ?? "Invoice groups"}</h1></div>
          {onCollapse ? <button type="button" className="ic-icobtn" onClick={onCollapse} aria-label="Collapse invoice sidebar" aria-expanded={true} aria-controls="invoice-sidebar" title="Collapse sidebar"><Icon name="panelClose" /></button> : null}
        </div>
        <div className="ic-queue-actions">
          {project && onOutlook ? (
            <button
              className="ic-btn ic-btn--secondary ic-btn--sm"
              type="button"
              onClick={onOutlook}
              title="Connect or import from Microsoft Outlook"
            >
              <Icon name="mail" size="ui" />
              Outlook
            </button>
          ) : null}
          {project ? <button className="ic-btn ic-btn--primary ic-btn--sm" type="button" onClick={onUpload} disabled={!canUpload}>
            <Icon name="upload" size="ui" />
            Upload
          </button> : null}
        </div>
      </div>
      {project ? <p className="muted" style={{ margin: "0 16px 12px", fontSize: "calc(12px * var(--text-scale))" }}>PDF, XML, ZIP or RAR</p> : null}
      <Search label={project ? "Search invoices" : "Search groups"} value={q} onChange={onQ} full />
      {project && !totalsOnly ? <div className="ic-seg ic-seg--fill" role="group" aria-label="Invoice status">
        <button type="button" aria-pressed={segment === "decide"} onClick={() => setSegment("decide")}>
          To decide <span className={projectDecide.length ? "ic-pill ic-pill--warn" : "n"}>{projectDecide.length}</span>
        </button>
        <button type="button" aria-pressed={segment === "done"} onClick={() => setSegment("done")}>
          Done <span className="n">{projectDone.length}</span>
        </button>
      </div> : null}
      {!project ? <CreateProject onCreated={(p) => onProject(p.id)} /> : null}
      <div className="ic-queue-list">
        {notices.map((n) => (
          <Notice key={n.key} tone={n.kind === "queued" ? undefined : "warn"} onDismiss={n.retryUpload ? undefined : () => dismissNotice(n.key)}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "calc(13px * var(--text-scale))" }}>
              {n.text}
              {n.retryUpload ? <span style={{ display: "flex", gap: 12 }}>
                <button type="button" className="ic-link ic-link--sm" onClick={resumeUploads}>Retry uploads</button>
                <button type="button" className="ic-link ic-link--sm" onClick={resetUploadsSession}>Cancel waiting uploads</button>
              </span> : null}
              {n.invoiceId ? (
                <Link className="ic-link ic-link--sm" href={`/invoices?id=${n.invoiceId}`} onClick={() => dismissNotice(n.key)} style={{ minHeight: 28 }}>
                  Open it
                  <Icon name="arrowR" arrow />
                </Link>
              ) : null}
            </span>
          </Notice>
        ))}
        {current ? (
          <div className="ic-qup" role="status" aria-live="polite">
            <b style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.name}</b>
            <div className="ic-progress ic-progress--full">
              <span />
            </div>
            <span className="muted">
              {current.status === "unpacking" ? "Unpacking…" : current.status === "uploading" ? "Uploading… keep this page open" : "Waiting to upload…"}{projectUploads.length > 1 ? ` · ${projectUploads.length - 1} more waiting` : ""}
            </span>
          </div>
        ) : null}
        {loadError ? (
          <Notice tone="warn">
            <span style={{ fontSize: "calc(13px * var(--text-scale))" }}>{loadError}</span>
            <button type="button" className="ic-link ic-link--sm" onClick={onRetryLoad}>
              Try again
            </button>
          </Notice>
        ) : null}
        {project ? <>
          {list.map((inv) => <Card key={inv.id} inv={inv} current={inv.id === selected} done={!!inv.outcome} />)}
          {!list.length && !loadError ? <p className="ic-hint">{ql ? "No invoices match." : totalsOnly ? "No invoices yet." : segment === "done" ? "No decided invoices yet." : "No invoices to decide."}</p> : null}
        </> : projects.filter((p) => !ql || p.name.toLowerCase().includes(ql)).map((p) => (
          <button type="button" className="ic-project-name ic-project-entry" key={p.id} onClick={() => onProject(p.id)}>
            <Icon name="folder" /><b>{p.name}</b><span className="muted">{p.invoice_count}</span><Icon name="chev" />
          </button>
        ))}
        {!projects.length && !loadError ? <p className="ic-hint">Create an invoice group to add invoices.</p> : null}
      </div>
    </aside>
  );
}
