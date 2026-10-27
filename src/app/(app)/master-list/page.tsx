"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { Notice, Search } from "@/components/ui";
import { money, whenLabel } from "@/checker/present";
import type { MasterItem } from "@/masterList";
import { MasterImport } from "@/components/MasterImport";
import { ColumnMappings } from "@/components/ColumnMappings";

const day = (iso: string | null) => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const valid = (i: MasterItem) => (i.validFrom || i.validTo ? `${day(i.validFrom)} – ${day(i.validTo)}` : "");
const pct = (d: string | number | null) => (d ? `${Number((Number(d) * 100).toFixed(2))}%` : "");

function FirstRun() {
  const router = useRouter();
  return <div className="ic-page ic-page--narrow" style={{ paddingTop: 56 }}>
    <h1 className="ic-h1">Upload your master list</h1>
    <MasterImport onSaved={() => router.replace("/master-list?uploaded=1")} />
  </div>;
}

function MasterListView() {
  const { masterList } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [replace, setReplace] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const replaceOpen = replace || params.get("replace") === "1";
  const uploaded = params.get("uploaded") === "1";

  const items = useMemo(() => masterList?.items ?? [], [masterList]);
  const suppliers = useMemo(() => [...new Set(items.map((i) => i.supplier).filter((value): value is string => Boolean(value)))].sort(), [items]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter(
      (i) => (!supplier || i.supplier === supplier) && (!ql || [i.name, i.supplier, i.po, i.item, i.description].join(" ").toLowerCase().includes(ql)),
    );
  }, [items, q, supplier]);

  if (!masterList) return <FirstRun />;

  const closeReplacement = () => {
    setReplace(false);
    if (params.get("replace")) router.replace("/master-list");
  };
  if (replaceOpen) return <div className="ic-page ic-page--narrow" style={{ paddingTop: 40 }}>
    <div className="ic-headrow"><h1 className="ic-h1">Replace master list</h1>
      <button className="ic-btn ic-btn--secondary" type="button" onClick={closeReplacement}>Cancel replacement</button>
    </div>
    <p className="muted">Your current list stays in use until you confirm the replacement.</p>
    <MasterImport replace onSaved={closeReplacement} />
  </div>;

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
            {masterList.file} · Uploaded {whenLabel(masterList.uploadedAt)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {masterList.columnMapping ? <button type="button" className="ic-btn ic-btn--secondary" onClick={() => setMappingOpen(true)}>Column mappings</button> : null}
          <button type="button" className="ic-btn ic-btn--secondary" onClick={() => setReplace(true)}>Replace file</button>
        </div>
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
                <th scope="col" className="r">No.</th>
                <th>Supplier</th>
                <th>PO</th>
                <th>Item</th>
                <th>Name</th>
                <th className="r">Quantity</th>
                <th>Unit</th>
                <th className="r">Unit price</th>
                <th className="r">Total price</th>
                <th className="r">Discount</th>
                <th>Valid</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((i, n) => (
                  <tr key={`${i.supplier}-${i.po}-${i.item}-${n}`}>
                    <td className="r num">{n + 1}</td>
                    <td>{i.supplier}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{i.po}</td>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                      {i.item}
                    </td>
                    <td className="trunc" title={i.name}>
                      {i.name}
                    </td>
                    <td className="r">{i.quantity ?? "—"}</td>
                    <td>{i.unit}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {i.currency ? money(Number(i.price), i.currency) : i.price}
                    </td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {i.totalPrice !== undefined ? (i.currency ? money(Number(i.totalPrice), i.currency) : i.totalPrice) : i.quantity === null ? (i.currency ? money(Number(i.price), i.currency) : i.price) : "—"}
                    </td>
                    <td className="r">{pct(i.discount)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{valid(i)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="muted">
                    {q || supplier ? "No items match." : "The master list has no items."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {masterList.columnMapping ? <ColumnMappings
        open={mappingOpen}
        selection={masterList.columnMapping}
        onClose={() => setMappingOpen(false)}
      /> : null}
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
