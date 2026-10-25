"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoiceFileUrl, reloadInvoices } from "@/checker/api";
import { exportReadyToPay, whenLabel } from "@/checker/present";
import { csvName } from "@/checker/review";
import { summarize } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { enqueue, useUploads } from "@/checker/uploads";
import { useApp } from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { AllDecided, CheckPane } from "@/components/invoices/CheckPane";
import { OutlookDialog } from "@/components/invoices/OutlookDialog";
import { Queue } from "@/components/invoices/Queue";
import { PdfView } from "@/components/PdfView";
import { download, Dropzone, Notice, useFilePicker } from "@/components/ui";

const PDF = "application/pdf,.pdf";

function MasterPanel() {
  const { masterList } = useApp();
  if (!masterList) return null;
  return (
    <aside className="ic-panel" aria-label="Master list">
      <div className="ic-grp">
        <h3>Master list</h3>
        <div className="ic-fact">
          <Icon name="sheet" size="ui" />
          <span className="v">
            <span>{masterList.file}</span>
            <span className="muted">Uploaded {whenLabel(masterList.uploadedAt)}</span>
          </span>
        </div>
        <div className="ic-fact">
          <Icon name="list" size="ui" />
          <span className="v">
            <span>{masterList.items.length} items</span>
            <span className="muted">{masterList.supplierCount} suppliers</span>
          </span>
        </div>
        <Link className="ic-link" href="/master-list">
          View master list
          <Icon name="arrowR" arrow />
        </Link>
      </div>
    </aside>
  );
}

function GuidedSetup({ onOutlook }: { onOutlook: () => void }) {
  const { invoices } = useApp();
  const uploads = useUploads();
  const known = () => invoices ?? [];
  const add = (files: File[]) => enqueue(files, known);
  const busy = uploads.items.length > 0;
  return (
    <div className="ic-page" style={{ paddingTop: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="ic-h1" style={{ margin: 0 }}>Upload your first invoice</h1>
        <button type="button" className="ic-btn ic-btn--secondary" onClick={onOutlook}>
          <Icon name="mail" size="ui" />
          Import from Outlook
        </button>
      </div>
      <div className="ic-split">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {uploads.notices.map((n) => (
            <Notice key={n.key} tone="warn">
              {n.text}
            </Notice>
          ))}
          {busy ? (
            <>
              <section className="ic-card" aria-label="Uploads" role="status" aria-live="polite">
                {uploads.items.map((it, i) => (
                  <div key={it.key} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderTop: i ? "1px solid var(--line)" : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Icon name="doc" size="row" />
                      <span style={{ flex: 1, fontWeight: i === 0 ? 600 : 400 }}>{it.name}</span>
                      <span className="muted">{it.status === "checking" ? "Checking…" : "Waiting"}</span>
                    </div>
                    {it.status === "checking" ? (
                      <div className="ic-progress ic-progress--full">
                        <span />
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
              <p className="muted" style={{ margin: 0 }}>
                Each invoice takes up to a minute. You can leave this page.
              </p>
              <Dropzone size="sm" title="Drop more PDFs, or" hint="" accept={PDF} multiple inputLabel="More invoice PDFs" onFiles={add} />
            </>
          ) : (
            <Dropzone title="Drop invoice PDFs here" hint="Up to 20 MB each." accept={PDF} multiple inputLabel="Invoice PDFs" onFiles={add} />
          )}
        </div>
        <MasterPanel />
      </div>
    </div>
  );
}

function Workspace({ onOutlook }: { onOutlook: () => void }) {
  const { invoices, invoiceError, masterList } = useApp();
  const uploads = useUploads();
  const params = useSearchParams();
  const router = useRouter();
  const [seg, setSeg] = useState<"decide" | "done">("decide");
  const [q, setQ] = useState("");
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [focusState, setFocus] = useState<{ id: string; n: number; seq: number } | null>(null);
  const known = () => invoices ?? [];
  const picker = useFilePicker(PDF, true, (files) => enqueue(files, known));

  const piles = useMemo(() => summarize(invoices ?? []).piles, [invoices]);
  const all = invoices ?? [];
  const idParam = params.get("id");
  const fallback = piles.decide[0]?.id ?? null;
  const selectedId = idParam && all.some((i) => i.id === idParam) ? idParam : fallback;
  const inv: SupplierInvoice | null = all.find((i) => i.id === selectedId) ?? null;

  // Each upload that finishes while this page is open is selected.
  const doneCount = uploads.doneCount;
  const lastId = uploads.lastDone?.id;
  const seen = useRef(doneCount);
  useEffect(() => {
    if (doneCount > seen.current && lastId) {
      seen.current = doneCount;
      router.replace(`/invoices?id=${lastId}`, { scroll: false });
    }
  }, [doneCount, lastId, router]);

  // "Show" focus belongs to the invoice it was clicked on.
  const focus = focusState && focusState.id === selectedId ? focusState : null;

  const marks = useMemo(
    () => (inv ? inv.lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.result !== "match").map((x) => ({ n: x.n, part: x.l.part, description: x.l.description })) : []),
    [inv],
  );
  const blocks = useMemo(() => inv?.blocks ?? [], [inv]);
  const pdfOpen = !!inv && pdfId === inv.id;
  const exportCsv = () => download(csvName(), exportReadyToPay(all));

  return (
    <div className={`ic-work${pdfOpen ? "" : " ic-work--no-pdf"}`}>
      {picker.node}
      <Queue
        decideList={piles.decide}
        doneList={piles.done}
        seg={seg}
        onSeg={setSeg}
        q={q}
        onQ={setQ}
        selected={selectedId}
        uploads={uploads.items}
        notices={uploads.notices}
        onUpload={picker.open}
        onOutlook={onOutlook}
        loadError={invoices === null ? invoiceError : null}
        onRetryLoad={reloadInvoices}
      />
      {inv ? (
        <CheckPane
          key={inv.id}
          inv={inv}
          masterList={masterList}
          activeLine={pdfOpen ? (focus?.n ?? null) : null}
          onOpenPdf={() => setPdfId(inv.id)}
          pdfOpen={pdfOpen}
          onShow={(n) => {
            setPdfId(inv.id);
            setFocus((f) => ({ id: inv.id, n, seq: (f?.seq ?? 0) + 1 }));
          }}
        />
      ) : invoices === null ? (
        <section className="ic-check" aria-label="Check">
          <div className="ic-check-center">
            <p className="muted">{invoiceError ? "Invoices couldn’t be loaded." : "Loading…"}</p>
          </div>
        </section>
      ) : (
        <AllDecided count={piles.done.length} onUpload={picker.open} onExport={exportCsv} />
      )}
      {inv && pdfOpen ? (
        <div className="ic-docpane">
          <PdfView key={inv.id} url={invoiceFileUrl(inv.id)} fileName={inv.fileName} marks={marks} rotations={inv.pageRotations} blocks={blocks} focus={focus} onClose={() => setPdfId(null)} />
        </div>
      ) : null}
    </div>
  );
}

function InvoicesView() {
  const { phase, invoices } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissedQueryNotice, setDismissedQueryNotice] = useState(false);

  const outlookParam = params.get("outlook");
  const outlookError = params.get("outlook_error");
  const openFromQuery = Boolean(outlookParam || outlookError);
  const outlookOpen = manualOpen || openFromQuery;

  const initialNotice = useMemo(() => {
    if (dismissedQueryNotice) return null;
    if (outlookError) return { tone: "warn" as const, text: outlookError };
    if (outlookParam === "connected") {
      return { text: "Microsoft Outlook connected. Select an email to view its content or import PDF attachments." };
    }
    return null;
  }, [dismissedQueryNotice, outlookError, outlookParam]);

  const clearOutlookQuery = () => {
    const id = params.get("id");
    router.replace(id ? `/invoices?id=${encodeURIComponent(id)}` : "/invoices", { scroll: false });
  };

  const closeOutlook = () => {
    setManualOpen(false);
    setDismissedQueryNotice(false);
    if (openFromQuery) clearOutlookQuery();
  };

  useEffect(() => {
    if (phase === "first") router.replace("/master-list");
  }, [phase, router]);
  if (phase === "first") return null;
  if (phase === "loading")
    return (
      <div className="ic-page">
        <p className="muted">Loading…</p>
      </div>
    );
  const known = () => invoices ?? [];
  return (
    <>
      {phase === "setup" ? (
        <GuidedSetup onOutlook={() => setManualOpen(true)} />
      ) : (
        <Workspace onOutlook={() => setManualOpen(true)} />
      )}
      <OutlookDialog
        open={outlookOpen}
        onClose={closeOutlook}
        onImportFiles={(files) => enqueue(files, known)}
        initialNotice={initialNotice}
        onClearInitialNotice={() => setDismissedQueryNotice(true)}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InvoicesView />
    </Suspense>
  );
}
