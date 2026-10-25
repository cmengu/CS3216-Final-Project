"use client";

import Link from "next/link";
import { money, OUTCOME_PILL, queueAttention, shortDate, statusPill, whenLabel } from "@/checker/present";
import type { SupplierInvoice } from "@/checker/types";
import { dismissNotice, type QueueItem, type UploadNotice } from "@/checker/uploads";
import { Icon } from "@/components/icons";
import { Notice, Pill, Search } from "@/components/ui";

function Card({ inv, current, done }: { inv: SupplierInvoice; current: boolean; done: boolean }) {
  const attn = done ? null : queueAttention(inv);
  return (
    <Link className="ic-qcard" href={`/invoices?id=${inv.id}`} aria-current={current ? "true" : undefined} scroll={false}>
      <span className="r1">
        <b>{inv.supplier ?? inv.fileName}</b>
        <span className="muted num" style={{ whiteSpace: "nowrap" }}>
          {shortDate(inv)}
        </span>
      </span>
      <span className="r2 muted">
        <span>{inv.number ?? (inv.supplier ? inv.fileName : "")}</span>
        <span className="num">{inv.total !== null ? money(inv.total, inv.currency) : ""}</span>
      </span>
      <span className="r3">
        {done && inv.outcome ? (
          <>
            <Pill pill={OUTCOME_PILL[inv.outcome]} />
            <span className="muted">{whenLabel(inv.decidedAt)}</span>
          </>
        ) : (
          <>
            <Pill pill={statusPill(inv)} />
            {attn ? <span className="ic-attn">{attn}</span> : null}
          </>
        )}
      </span>
    </Link>
  );
}

export function Queue({
  decideList,
  doneList,
  seg,
  onSeg,
  q,
  onQ,
  selected,
  uploads,
  notices,
  onUpload,
  onOutlook,
  loadError,
  onRetryLoad,
}: {
  decideList: SupplierInvoice[];
  doneList: SupplierInvoice[];
  seg: "decide" | "done";
  onSeg: (s: "decide" | "done") => void;
  q: string;
  onQ: (q: string) => void;
  selected: string | null;
  uploads: QueueItem[];
  notices: UploadNotice[];
  onUpload: () => void;
  onOutlook?: () => void;
  loadError: string | null;
  onRetryLoad: () => void;
}) {
  const ql = q.trim().toLowerCase();
  const match = (inv: SupplierInvoice) => !ql || [inv.supplier, inv.number, inv.fileName, inv.purchaseOrder].join(" ").toLowerCase().includes(ql);
  const list = (seg === "decide" ? decideList : doneList).filter(match);
  const current = uploads[0];
  return (
    <aside className="ic-queue" aria-label="Invoices">
      <div className="ic-queue-h">
        <h1>Invoices</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onOutlook ? (
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
          <button className="ic-btn ic-btn--primary ic-btn--sm" type="button" onClick={onUpload}>
            <Icon name="upload" size="ui" />
            Upload
          </button>
        </div>
      </div>
      <Search label="Search invoices" value={q} onChange={onQ} full />
      <div className="ic-seg ic-seg--fill" role="group" aria-label="Show">
        <button type="button" aria-pressed={seg === "decide"} onClick={() => onSeg("decide")}>
          To decide{" "}
          {decideList.length ? (
            <span className="ic-pill ic-pill--warn">{decideList.length}</span>
          ) : (
            <span className="n">0</span>
          )}
        </button>
        <button type="button" aria-pressed={seg === "done"} onClick={() => onSeg("done")}>
          Done <span className="n">{doneList.length}</span>
        </button>
      </div>
      <div className="ic-queue-list">
        {notices.map((n) => (
          <Notice key={n.key} tone="warn" onDismiss={() => dismissNotice(n.key)}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
              {n.text}
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
              Checking…{uploads.length > 1 ? ` · ${uploads.length - 1} more waiting` : ""}
            </span>
          </div>
        ) : null}
        {loadError ? (
          <Notice tone="warn">
            <span style={{ fontSize: 13 }}>{loadError}</span>
            <button type="button" className="ic-link ic-link--sm" onClick={onRetryLoad}>
              Try again
            </button>
          </Notice>
        ) : null}
        {list.map((inv) => (
          <Card key={inv.id} inv={inv} current={inv.id === selected} done={seg === "done"} />
        ))}
        {!list.length && !loadError ? (
          seg === "decide" && !ql ? (
            <p className="ic-ok" style={{ padding: "8px 4px" }}>
              <Icon name="tick" />
              Nothing to decide.
            </p>
          ) : (
            <p className="ic-empty" style={{ padding: "8px 4px" }}>
              {ql ? "No invoices match." : "No decided invoices yet."}
            </p>
          )
        ) : null}
      </div>
    </aside>
  );
}
