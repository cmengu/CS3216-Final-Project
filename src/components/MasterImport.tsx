"use client";

import { useState } from "react";
import { Dropzone } from "@/components/ui";
import { ColumnMappings, columnLabel, columnName } from "@/components/ColumnMappings";
import { previewMasterList, replaceMasterList, uploadMasterList, type ImportOptions, type ImportPreview } from "@/masterList";

const ACCEPT = ".csv,.xlsx,.xls";

/** A row as its first few non-empty cells: "part_number, description, currency, …". */
const rowSummary = (row: string[]) => {
  const cells = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  if (!cells.length) return "(empty row)";
  const text = cells.slice(0, 4).join(", ") + (cells.length > 4 ? ", …" : "");
  return text.length > 70 ? text.slice(0, 69) + "…" : text;
};

/** Preview with AI column mapping and open the mapping dialog so the user only needs to confirm. */
export function MasterImport({ replace = false, onSaved, projectId }: { replace?: boolean; onSaved: () => void; projectId?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState("");
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState("");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const selected = preview?.sheets.find((candidate) => candidate.name === sheet);
  const rows = selected?.rows ?? [];
  const columns = rows[header] ?? [];
  const missing = preview?.required.filter((key) => mapping[key] === undefined) ?? [];
  const options = { sheet, header, mapping };

  async function save(chosen: File, selection: ImportOptions) {
    setBusy("saving"); setError("");
    try {
      const result = await (replace ? replaceMasterList : uploadMasterList)(chosen, selection, projectId);
      if (result.ok) { setMappingOpen(false); onSaved(); }
      else { setError(result.reason); setMappingOpen(true); }
    } finally { setBusy(null); }
  }

  async function loadPreview(chosen: File, reopenModal = false) {
    setBusy("reading"); setError("");
    if (!reopenModal) { setPreview(null); setFile(chosen); setMappingOpen(false); }
    try {
      const result = await previewMasterList(chosen);
      const first = result.sheets.find((candidate) => result.required.every((key) => candidate.mapping[key] !== undefined)) ?? result.sheets[0];
      if (!first) throw new Error("No worksheets with data were found.");
      setPreview(result); setSheet(first.name); setHeader(first.header); setMapping(first.mapping);
      setBusy(null); setMappingOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file."); setBusy(null);
    }
  }

  function changeMapping(field: string, value: string) {
    setMapping((old) => {
      const next = { ...old };
      if (value === "") delete next[field]; else next[field] = Number(value);
      return next;
    });
    setError("");
  }

  return <div style={{ display: "grid", gap: 16 }}>
    <Dropzone size={preview ? "sm" : "lg"}
      title={busy === "reading" ? "Reading your master list…" : busy === "saving" ? "Importing your master list…" : file?.name ?? "Drop your master list here"}
      formats="CSV or Excel" accept={ACCEPT} inputLabel="Master list file" state={{ kind: "idle" }}
      onFiles={async ([chosen]) => {
        if (busy || !chosen) return;
        await loadPreview(chosen);
      }} />
    {error && !mappingOpen ? <p className="ic-hint ic-hint--error" role="alert">{error}</p> : null}
    {preview ? <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="muted">Preview of your file</span>
        <button type="button" className="ic-btn ic-btn--secondary" disabled={!!busy} onClick={() => setMappingOpen(true)}>Column mappings</button>
      </div>
      <div style={{ overflow: "auto", maxHeight: 400 }}>
        <table className="ic-grid" aria-label="Master list preview">
          <thead><tr>{columns.map((name, index) => <th key={index}>{name || `Column ${index + 1}`}</th>)}</tr></thead>
          <tbody>{rows.slice(header + 1).map((row, index) => <tr key={index}>{columns.map((_, column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {!busy ? <button type="button" className="ic-btn ic-btn--primary" onClick={() => setMappingOpen(true)}>
        {replace ? "Review replacement" : "Review and import"}
      </button> : null}
      <ColumnMappings open={mappingOpen} onClose={() => { if (!busy) setMappingOpen(false); }} selection={{ ...options, columns }}
        footer={<>
          <button type="button" className="ic-btn ic-btn--secondary" disabled={!!busy} onClick={() => setMappingOpen(false)}>Cancel</button>
          <button type="button" className="ic-btn ic-btn--primary" disabled={!!busy || !file || missing.length > 0}
            onClick={() => { if (file) void save(file, options); }}>
            {busy === "saving" ? "Importing…" : replace ? "Replace master list" : "Import master list"}
          </button>
        </>}>
        <p className="ic-lead">{selected?.mappingSource === "ai" ? "AI matched these columns. Make sure they're right." : "Choose which column holds each field."}</p>
        {missing.length ? <p className="ic-hint ic-hint--error" role="alert">Choose a column for {missing.map(columnLabel).join(" and ")}.</p> : null}
        {selected?.mappingSource !== "ai" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            {selected?.note ? <p className="ic-hint" role="status" style={{ margin: 0 }}>{selected.note}</p> : null}
            {file ? (
              <button type="button" className="ic-btn ic-btn--secondary ic-btn--sm" disabled={!!busy} onClick={() => void loadPreview(file, true)}>
                {busy === "reading" ? "Retrying…" : "Retry AI mapping"}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="ic-hint ic-hint--error" role="alert">{error}</p> : null}
        {/* Where the AI found the headings, said with the headings themselves; changing it is rarely needed. */}
        <div className="ic-source">
          <p style={{ margin: 0 }}>
            Headings read from {preview.sheets.length > 1 ? <>sheet <b>{sheet}</b>, </> : null}row {header + 1}: <span className="muted">{rowSummary(columns)}</span>
          </p>
          {!sourceOpen ? <button type="button" className="ic-link ic-link--sm" style={{ minHeight: 32 }} onClick={() => setSourceOpen(true)}>Change</button> : null}
        </div>
        {sourceOpen || missing.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {preview.sheets.length > 1 ? <label className="ic-field">Sheet <select className="ic-select ic-select--block" disabled={!!busy} value={sheet} onChange={(e) => {
              const next = preview.sheets.find((candidate) => candidate.name === e.target.value)!;
              setSheet(next.name); setHeader(next.header); setMapping(next.mapping); setError("");
            }}>{preview.sheets.map((candidate) => <option key={candidate.name}>{candidate.name}</option>)}</select></label> : null}
            <label className="ic-field">Which row has the headings? <select className="ic-select ic-select--block" disabled={!!busy} value={header} onChange={(e) => {
              const next = Number(e.target.value);
              setHeader(next); setMapping(next === selected?.header ? selected.mapping : {}); setError("");
            }}>{rows.slice(0, Math.max(20, header + 1)).map((row, index) => <option key={index} value={index}>Row {index + 1}: {rowSummary(row)}</option>)}</select></label>
          </div>
        ) : null}
        <table className="ic-grid ic-grid--strong"><thead><tr><th>Field</th><th>Column in your file</th></tr></thead>
          <tbody>{[...preview.required, ...preview.fields.filter((key) => !preview.required.includes(key))].map((field) => <tr key={field}>
            <td><label htmlFor={`mapping-${field}`}>{columnLabel(field)}{preview.required.includes(field) ? " *" : ""}</label></td>
            <td><select id={`mapping-${field}`} className="ic-select ic-select--block" disabled={!!busy} value={mapping[field] ?? ""} onChange={(e) => changeMapping(field, e.target.value)}>
              <option value="">{preview.required.includes(field) ? "Choose a column" : "Not in file"}</option>
              {columns.map((_, index) => <option key={index} value={index}>{columnName(columns, index)}</option>)}
            </select></td>
          </tr>)}</tbody>
        </table>
      </ColumnMappings>
    </> : null}
  </div>;
}
