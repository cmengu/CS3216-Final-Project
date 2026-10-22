"use client";
import { useState } from "react";
import { Dropzone } from "@/components/ui";
import { previewMasterList, replaceMasterList, uploadMasterList, type ImportPreview } from "@/masterList";

const ACCEPT = ".csv,.xlsx,.xls";
/** Explicit mapping supports arbitrary column headings without guessing values. */
export function MasterImport({ replace = false, onSaved }: { replace?: boolean; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState("");
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = preview?.sheets.find((s) => s.name === sheet)?.rows ?? [];
  const columns = rows[header] ?? [];
  const selectedPreview = preview?.sheets.find((s) => s.name === sheet);
  return <div style={{ display: "grid", gap: 16 }}>
    <Dropzone title={busy ? "Reading the file and identifying columns…" : file?.name ?? "Drop your master list here"} formats="CSV or Excel" accept={ACCEPT} inputLabel="Master list file" state={error ? { kind: "error", title: "Couldn’t import the file", reason: error } : { kind: "idle" }} onFiles={async ([chosen]) => {
      if (busy || !chosen) return;
      setBusy(true); setError(""); setPreview(null); setFile(chosen);
      try {
        const result = await previewMasterList(chosen);
        const first = result.sheets.find((candidate) => result.required.every((key) => candidate.mapping[key] !== undefined)) ?? result.sheets[0];
        if (!first) throw new Error("No worksheets with data were found.");
        setPreview(result); setSheet(first.name); setHeader(first.header); setMapping(first.mapping);
      } catch (err) { setError(err instanceof Error ? err.message : "Could not read file"); }
      finally { setBusy(false); }
    }} />
    {preview ? <>
      <p className="ic-hint">Review the name, unit price and other columns before {replace ? "replacing" : "importing"} your master list. Unit and currency are needed for invoice price comparisons.</p>
      {selectedPreview?.note ? <p className="ic-hint" role="status">{selectedPreview.note}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label>Worksheet <select className="ic-select" disabled={busy} value={sheet} onChange={(e) => {
          const selected = preview.sheets.find((s) => s.name === e.target.value)!;
          setSheet(selected.name); setHeader(selected.header); setMapping(selected.mapping); setError("");
        }}>{preview.sheets.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
        <label>Header row <select className="ic-select" disabled={busy} value={header} onChange={(e) => { setHeader(Number(e.target.value)); setMapping({}); setError(""); }}>
          {rows.map((_, index) => <option key={index} value={index}>Row {index + 1}</option>)}
        </select></label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{[...preview.required, "quantity"].map((key) => <label key={key} style={{ display: "grid", gap: 4 }}>{key === "price" ? "Unit price" : key[0].toUpperCase() + key.slice(1)}{preview.required.includes(key) ? " *" : ""}
        <select className="ic-select" disabled={busy} value={mapping[key] ?? ""} onChange={(e) => setMapping((old) => { const next = { ...old }; if (e.target.value === "") delete next[key]; else next[key] = Number(e.target.value); return next; })}>
          <option value="">{key === "quantity" ? "None" : "Select column"}</option>{columns.map((name, index) => <option key={index} value={index}>{index + 1}: {name || "Unnamed"}</option>)}
        </select>
      </label>)}</div>
      <details><summary>Optional fields</summary><div style={{ display: "flex", flexWrap: "wrap", gap: 12, paddingTop: 12 }}>{preview.fields.filter((key) => !preview.required.includes(key) && key !== "quantity").map((key) => <label key={key} style={{ display: "grid", gap: 4 }}>{key}
        <select className="ic-select" disabled={busy} value={mapping[key] ?? ""} onChange={(e) => setMapping((old) => { const next = { ...old }; if (e.target.value === "") delete next[key]; else next[key] = Number(e.target.value); return next; })}>
          <option value="">Not provided</option>{columns.map((name, index) => <option key={index} value={index}>{index + 1}: {name || "Unnamed"}</option>)}
        </select>
      </label>)}</div></details>
      <div style={{ overflow: "auto", maxHeight: 220 }}><table className="ic-grid"><thead><tr>{columns.map((name, index) => <th key={index}>{name || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{rows.slice(header + 1, header + 6).map((row, index) => <tr key={index}>{columns.map((_, column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table></div>
      <button type="button" className="ic-btn ic-btn--primary" disabled={busy || !file || preview.required.some((key) => mapping[key] === undefined)} onClick={async () => {
        if (!file) return;
        setBusy(true); setError("");
        const result = await (replace ? replaceMasterList : uploadMasterList)(file, { sheet, header, mapping });
        setBusy(false);
        if (result.ok) onSaved(); else setError(result.reason);
      }}>{busy ? "Saving…" : replace ? "Replace master list" : "Import master list"}</button>
    </> : null}
  </div>;
}
