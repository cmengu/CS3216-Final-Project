"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { Dialog, Dropzone, Notice, Search, type DropState } from "@/components/ui";
import { money, whenLabel } from "@/checker/present";
import { replaceMasterList, uploadMasterList, type MasterItem } from "@/masterList";

const ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const day = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const valid = (i: MasterItem) => (i.validFrom || i.validTo ? `${day(i.validFrom)} – ${day(i.validTo)}` : "");
const pct = (d: number) => (d ? `${Number((d * 100).toFixed(2))}%` : "");

function FirstRun() {
  const router = useRouter();
  const [state, setState] = useState<DropState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="ic-page ic-page--narrow" style={{ paddingTop: 56 }}>
      <div className="ic-titleblock">
        <h1 className="ic-h1">Upload your master list</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Every invoice is checked against it.
        </p>
      </div>
      <Dropzone
        title={busy ? "Reading the file…" : "Drop your master list here"}
        hint="CSV or Excel."
        accept={ACCEPT}
        state={state}
        inputLabel="Master list file"
        onFiles={async ([file]) => {
          setBusy(true);
          const r = await uploadMasterList(file);
          setBusy(false);
          if (r.ok) router.replace("/master-list?uploaded=1");
          else setState({ kind: "error", title: `Couldn’t use ${file.name}`, reason: r.reason });
        }}
      />
      <p className="muted" style={{ margin: 0 }}>
        Needs supplier, item, unit and price columns.
      </p>
    </div>
  );
}

function ReplaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<DropState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const close = () => {
    setFile(null);
    setState({ kind: "idle" });
    onClose();
  };
  return (
    <Dialog
      open={open}
      title="Replace master list"
      onClose={close}
      footer={
        <>
          <button type="button" className="ic-btn ic-btn--secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--primary"
            disabled={!file || busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              const r = await replaceMasterList(file);
              setBusy(false);
              if (r.ok) close();
              else setState({ kind: "error", title: `Couldn’t use ${file.name}`, reason: r.reason });
            }}
          >
            Replace
          </button>
        </>
      }
    >
      <Dropzone
        size="md"
        title={file ? file.name : "Drop your master list here"}
        hint={file ? "Ready to replace." : "CSV or Excel."}
        accept={ACCEPT}
        state={state}
        inputLabel="New master list file"
        onFiles={([f]) => {
          setFile(f);
          setState({ kind: "idle" });
        }}
      />
      <p className="muted" style={{ margin: 0 }}>
        Invoices already checked keep their result.
      </p>
      {!file ? (
        <p className="muted" style={{ margin: 0 }}>
          Choose a file to replace the master list.
        </p>
      ) : null}
    </Dialog>
  );
}

function MasterListView() {
  const { masterList } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [replace, setReplace] = useState(false);
  const replaceOpen = replace || params.get("replace") === "1";
  const uploaded = params.get("uploaded") === "1";

  const items = useMemo(() => masterList?.items ?? [], [masterList]);
  const suppliers = useMemo(() => [...new Set(items.map((i) => i.supplier).filter(Boolean))].sort(), [items]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter(
      (i) => (!supplier || i.supplier === supplier) && (!ql || [i.supplier, i.po, i.item, i.description].join(" ").toLowerCase().includes(ql)),
    );
  }, [items, q, supplier]);

  if (!masterList) return <FirstRun />;

  return (
    <div className="ic-page" style={{ height: "calc(100vh - var(--header-height))" }}>
      {uploaded ? (
        <Notice>
          <span className="ic-ok">
            <Icon name="tick" />
            Master list uploaded.
          </span>
          <Link className="ic-btn ic-btn--primary ic-btn--sm" href="/invoices" style={{ marginLeft: "auto" }}>
            <Icon name="upload" size="ui" />
            Upload invoice
          </Link>
        </Notice>
      ) : null}
      <div className="ic-headrow">
        <div className="ic-titleblock">
          <h1 className="ic-h1">Master list</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            {masterList.file} · {masterList.items.length} items · {masterList.supplierCount} suppliers · Uploaded {whenLabel(masterList.uploadedAt)}
          </p>
        </div>
        <button type="button" className="ic-btn ic-btn--secondary" onClick={() => setReplace(true)}>
          Replace file
        </button>
      </div>
      <div className="ic-controls">
        <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <Search label="Search items" placeholder="Search items" value={q} onChange={setQ} full />
        </div>
        <label className="sr" htmlFor="sup">
          Supplier
        </label>
        <select id="sup" className="ic-select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <section className="ic-card" aria-label="Master list items" style={{ padding: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="ic-scroll" style={{ overflow: "auto", flex: 1, minHeight: 0, borderRadius: 12 }}>
          <table className="ic-grid">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>PO</th>
                <th>Item</th>
                <th>Description</th>
                <th>Unit</th>
                <th className="r">Price</th>
                <th className="r">Discount</th>
                <th>Valid</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((i, n) => (
                  <tr key={`${i.supplier}-${i.po}-${i.item}-${n}`}>
                    <td>{i.supplier}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{i.po}</td>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                      {i.item}
                    </td>
                    <td className="trunc" title={i.description}>
                      {i.description}
                    </td>
                    <td>{i.unit}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {money(Number(i.price), i.currency)}
                    </td>
                    <td className="r">{pct(i.discount)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{valid(i)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="muted">
                    {q || supplier ? "No items match." : "The master list has no items."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <ReplaceDialog
        open={replaceOpen}
        onClose={() => {
          setReplace(false);
          if (params.get("replace")) router.replace("/master-list");
        }}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MasterListView />
    </Suspense>
  );
}
