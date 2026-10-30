"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoiceFileUrl, reloadInvoices } from "@/checker/api";
import { exportReadyToPay, whenLabel } from "@/checker/present";
import { csvName } from "@/checker/review";
import { summarize } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { INVOICE_ACCEPT } from "@/checker/upload-formats";
import { enqueue, useUploads } from "@/checker/uploads";
import { useApp } from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { AllDecided, CheckPane } from "@/components/invoices/CheckPane";
import { OutlookDialog } from "@/components/invoices/OutlookDialog";
import { Queue } from "@/components/invoices/Queue";
import { PdfView } from "@/components/PdfView";
import { XmlView } from "@/components/XmlView";
import { download, Dropzone, Notice, useFilePicker } from "@/components/ui";



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
            <Notice key={n.key} tone={n.kind === "queued" ? undefined : "warn"}>
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
                      <span className="muted">{it.status === "uploading" ? "Uploading…" : it.status === "unpacking" ? "Unpacking…" : "Waiting"}</span>
                    </div>
                    {it.status !== "waiting" ? (
                      <div className="ic-progress ic-progress--full">
                        <span />
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
              <p className="muted" style={{ margin: 0 }}>
                Keep this page open until the batch finishes uploading. Checking will then continue on the server.
              </p>
              <Dropzone size="sm" title="Drop more invoices or archives, or" hint="" accept={INVOICE_ACCEPT} multiple inputLabel="More invoices or archives" onFiles={add} />
            </>
          ) : (
            <Dropzone title="Drop invoices or archives here" hint="PDF or XML up to 20 MB each. ZIP or RAR up to 50 MB; 100 MB unpacked." accept={INVOICE_ACCEPT} multiple inputLabel="Invoice PDFs, XMLs or archives" onFiles={add} />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [focusState, setFocus] = useState<{ id: string; n: number; seq: number } | null>(null);
  const known = () => invoices ?? [];
  const picker = useFilePicker(INVOICE_ACCEPT, true, (files) => enqueue(files, known));

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
    () => (inv ? inv.lines.map((l, i) => ({ n: i + 1, part: l.part, description: l.description })) : []),
    [inv],
  );
  const blocks = useMemo(() => inv?.blocks ?? [], [inv]);
  const pdfOpen = !!inv && pdfId === inv.id;
  const closePdf = () => {
    setFocus(null);
    setPdfId(null);
  };

  useEffect(() => {
    if (!pdfOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".ic-dialog, .ic-drawer")) {
        setFocus(null);
        setPdfId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pdfOpen]);

  const exportCsv = () => download(csvName(), exportReadyToPay(all));

  return (
    <div className={`ic-work ic-work--no-pdf${sidebarCollapsed ? " ic-work--sidebar-collapsed" : ""}`}>
      {picker.node}
      {sidebarCollapsed ? (
        <aside id="invoice-sidebar" className="ic-sidebar-collapsed" aria-label="Invoice navigation">
          <button type="button" className="ic-icobtn" onClick={() => setSidebarCollapsed(false)} aria-label="Expand invoice sidebar" aria-expanded={false} aria-controls="invoice-sidebar" title="Expand sidebar"><Icon name="chev" /></button>
        </aside>
      ) : <Queue
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
        onCollapse={() => setSidebarCollapsed(true)}
      />}
      {inv ? (
        <CheckPane
          key={inv.id}
          inv={inv}
          masterList={masterList}
          activeLine={pdfOpen ? (focus?.n ?? null) : null}
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
      {inv && pdfOpen && /\.xml$/i.test(inv.fileName) ? (
        <XmlView key={`xml-${inv.id}`} inv={inv} url={invoiceFileUrl(inv.id)} fileName={inv.fileName} focus={focus} onSelectLine={(n) => setFocus((f) => ({ id: inv.id, n, seq: (f?.seq ?? 0) + 1 }))} onClose={closePdf} />
      ) : inv && pdfOpen ? (
        <PdfView
          key={`pdf-${inv.id}`}
          inv={inv}
          url={invoiceFileUrl(inv.id)}
          fileName={inv.fileName}
          marks={marks}
          rotations={inv.pageRotations}
          blocks={blocks}
          focus={focus}
          onSelectLine={(n) => setFocus((f) => ({ id: inv.id, n, seq: (f?.seq ?? 0) + 1 }))}
          onClose={closePdf}
        />
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
