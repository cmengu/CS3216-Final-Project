"use client";

import { findGroup } from "@/checker/group-url";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoiceFileUrl, reloadInvoices } from "@/checker/api";
import { money } from "@/checker/present";
import { useProjectMaster } from "@/checker/projects";
import { ProjectAssignment } from "@/components/invoices/ProjectAssignment";
import { summarize } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { INVOICE_ACCEPT } from "@/checker/upload-formats";
import { enqueue, useUploads } from "@/checker/uploads";
import { useApp } from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { CheckPane } from "@/components/invoices/CheckPane";
import { OutlookDialog } from "@/components/invoices/OutlookDialog";
import { Queue } from "@/components/invoices/Queue";
import { XmlView } from "@/components/XmlView";
import { PdfView } from "@/components/PdfView";
import { useFilePicker } from "@/components/ui";



function Workspace({ onOutlook }: { onOutlook: (projectId: string) => void }) {
  const { invoices, invoiceError, projects, projectError, projectsLoading, reloadProjects } = useApp();
  const uploads = useUploads();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [focusState, setFocus] = useState<{ id: string; n: number; seq: number } | null>(null);
  const known = () => invoices ?? [];

  const piles = useMemo(() => summarize(invoices ?? []).piles, [invoices]);
  const all = invoices ?? [];
  const idParam = params.get("id");
  // An explicit project-list URL keeps Back from reopening the default folder.
  const browsingProjects = params.get("view") === "projects";
  const linkedInvoice = all.find((i) => i.id === idParam);
  const defaultProject = projects.find((p) => p.id.startsWith("legacy:")) ?? projects[0];
  const projectId = browsingProjects ? null : (findGroup(projects, params)?.id ?? (params.has("group") ? null : params.get("project") ?? linkedInvoice?.projectId ?? defaultProject?.id ?? null));
  const project = projects.find((p) => p.id === projectId);
  useEffect(() => {
    if (!project || params.get("group") === project.name) return;
    const next = new URLSearchParams(params.toString());
    next.set("group", project.name);
    next.set("project", project.id);
    router.replace(`/invoices?${next}`, { scroll: false });
  }, [project, params, router]);
  const projectInvoices = all.filter((i) => i.projectId === projectId);
  const selectedId = browsingProjects ? null : (projectInvoices.find((i) => i.id === idParam)?.id ?? projectInvoices[0]?.id ?? null);
  const inv: SupplierInvoice | null = projectInvoices.find((i) => i.id === selectedId) ?? null;
  const { masterList } = useProjectMaster(project?.comparison_mode === "master_list" ? project.id : null);
  const canUpload = !!project && (project.comparison_mode === "totals_only" || project.has_master_list);
  const picker = useFilePicker(INVOICE_ACCEPT, true, (files) => { if (canUpload) enqueue(files, known, project.id); });
  const selectProject = (id: string) => {
    setQ("");
    router.push(`/invoices?project=${encodeURIComponent(id)}`, { scroll: false });
  };
  const backToProjects = () => {
    setQ("");
    router.push("/invoices?view=projects", { scroll: false });
  };

  // Each upload that finishes while this page is open is selected.
  const doneCount = uploads.doneCount;
  const lastId = uploads.lastDone?.id;
  const seen = useRef(doneCount);
  useEffect(() => {
    if (doneCount > seen.current && lastId) {
      seen.current = doneCount;
      reloadProjects();
      router.replace(`/invoices?id=${lastId}`, { scroll: false });
    }
  }, [doneCount, lastId, router, reloadProjects]);

  // Refresh project counts and currency totals as server-owned batches finish.
  useEffect(() => {
    reloadProjects();
  }, [invoices, reloadProjects]);

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


  return (
    <div className={`ic-work ic-work--no-pdf${sidebarCollapsed ? " ic-work--sidebar-collapsed" : ""}`}>
      {picker.node}
      {sidebarCollapsed ? (
        <aside id="invoice-sidebar" className="ic-sidebar-collapsed" aria-label="Invoice navigation">
          <button type="button" className="ic-icobtn" onClick={() => setSidebarCollapsed(false)} aria-label="Expand invoice sidebar" aria-expanded={false} aria-controls="invoice-sidebar" title="Expand sidebar"><Icon name="panelOpen" /></button>
        </aside>
      ) : <Queue
        decideList={piles.decide}
        doneList={piles.done}
        projects={projects}
        activeProject={projectId}
        onProject={selectProject}
        onBack={backToProjects}
        canUpload={canUpload}
        q={q}
        onQ={setQ}
        selected={selectedId}
        uploads={uploads.items}
        notices={uploads.notices}
        onUpload={picker.open}
        onOutlook={project ? () => onOutlook(project.id) : undefined}
        loadError={projectError ?? invoiceError}
        onRetryLoad={() => { reloadInvoices(); reloadProjects(); }}
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
        <section className="ic-check"><div className="ic-check-body ic-project-overview">
          <h1>{project?.name ?? (projectsLoading ? "Loading invoice groups…" : "Invoice groups")}</h1>
          {project ? <>
            <p className="muted">{project.comparison_mode === "totals_only" ? "Totals only · No master list" : "Invoices compared with this group’s master list"}</p>
            <section className="ic-card"><h2>Invoice totals</h2>
              {Object.entries(project.totals).map(([currency, total]) => <p key={currency} className="ic-h1">{money(Number(total), currency)}</p>)}
              {!Object.keys(project.totals).length ? <p>No completed invoice totals yet.</p> : null}
              <p className="muted">{project.included_count} of {project.invoice_count} invoices included</p>
              {project.excluded_count ? <p role="status">{project.excluded_count} excluded: still running, or missing a total or currency.</p> : null}
            </section>
            <div className="ic-controls">
              <button className="ic-btn ic-btn--primary" disabled={!canUpload} onClick={picker.open}>Upload invoices</button>
              {project.comparison_mode === "master_list" ? <Link className="ic-btn ic-btn--secondary" href={`/master-list?project=${encodeURIComponent(project.id)}`}>{project.has_master_list ? "View master list" : "Upload master list"}</Link> : null}
            </div>
            {!canUpload ? <p>Upload a master list for this group before adding invoices.</p> : null}
          </> : <section className="ic-card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="ic-grid ic-project-table" aria-label="Invoice groups">
              <thead><tr><th scope="col">No.</th><th scope="col">Group name</th><th scope="col">Number of invoices</th><th scope="col">Master list</th><th scope="col">Total sum</th></tr></thead>
              <tbody>
                {projects.map((p, index) => <tr key={p.id}>
                  <td className="num">{index + 1}</td>
                  <td><Link className="ic-link" href={`/invoices?project=${encodeURIComponent(p.id)}`} scroll={false}>{p.name}</Link></td>
                  <td className="num">{p.invoice_count}</td>
                  <td>{p.has_master_list ? "Yes" : "No"}</td>
                  <td className="num">
                    {Object.entries(p.totals).length ? Object.entries(p.totals).map(([currency, total]) => <div key={currency} style={{ whiteSpace: "nowrap" }}>{money(Number(total), currency)}</div>) : "—"}
                    {p.excluded_count ? <div className="ic-hint">{p.excluded_count} invoice{p.excluded_count === 1 ? "" : "s"} excluded</div> : null}
                  </td>
                </tr>)}
                {!projects.length ? <tr><td colSpan={5} className="muted">{projectsLoading ? "Loading invoice groups…" : projectError ? "Invoice groups could not be loaded." : "No invoice groups yet. Create one in the sidebar."}</td></tr> : null}
              </tbody>
            </table>
          </section>}
        </div></section>
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
  const { invoices, projects } = useApp();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const router = useRouter();
  const params = useSearchParams();
  const [manualOpen, setManualOpen] = useState(false);
  const [outlookProjectId, setOutlookProjectId] = useState<string | null>(null);
  const destinationId = outlookProjectId ?? params.get("project");
  const destination = projects.find((p) => p.id === destinationId);
  const [dismissedQueryNotice, setDismissedQueryNotice] = useState(false);

  const outlookParam = params.get("outlook");
  const outlookError = params.get("outlook_error");
  const openFromQuery = Boolean(outlookParam || outlookError);
  const outlookOpen = !!destination && (manualOpen || openFromQuery);

  const initialNotice = useMemo(() => {
    if (dismissedQueryNotice) return null;
    if (outlookError) return { tone: "warn" as const, text: outlookError };
    if (outlookParam === "connected") {
      return { text: "Microsoft Outlook connected. Select an email to view its content or import PDF attachments." };
    }
    return null;
  }, [dismissedQueryNotice, outlookError, outlookParam]);

  const clearOutlookQuery = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("outlook"); next.delete("outlook_error");
    router.replace(`/invoices?${next}`, { scroll: false });
  };

  const closeOutlook = () => {
    setManualOpen(false);
    setDismissedQueryNotice(false);
    if (openFromQuery) clearOutlookQuery();
  };

  const known = () => invoices ?? [];
  return (
    <>
      {pendingFiles.length && destination ? <ProjectAssignment key={destination.id} files={pendingFiles} project={destination} onCancel={() => setPendingFiles([])} onSubmit={(files) => {
        enqueue(files, known, destination.id);
        setPendingFiles([]);
      }} /> : <Workspace onOutlook={(projectId) => { setOutlookProjectId(projectId); setManualOpen(true); }} />}
      <OutlookDialog
        open={outlookOpen}
        returnTo={`/invoices?project=${encodeURIComponent(destinationId ?? "")}`}
        onClose={closeOutlook}
        onImportFiles={(files) => { setPendingFiles((old) => [...old, ...files]); closeOutlook(); }}
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
