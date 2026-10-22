"use client";

import { useState } from "react";
import { Dropzone } from "@/components/ui";
import { ColumnMappings, columnLabel } from "@/components/ColumnMappings";
import { previewMasterList, replaceMasterList, uploadMasterList, type ImportOptions, type ImportPreview } from "@/masterList";

const ACCEPT = ".csv,.xlsx,.xls";

/** Initial uploads import detected columns; replacements and incomplete mappings need confirmation. */
export function MasterImport({ replace = false, onSaved }: { replace?: boolean; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState("");
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState("");
  const [mappingOpen, setMappingOpen] = useState(false);
  const selected = preview?.sheets.find((candidate) => candidate.name === sheet);
  const rows = selected?.rows ?? [];
  const columns = rows[header] ?? [];
  const missing = preview?.required.filter((key) => mapping[key] === undefined) ?? [];
  const options = { sheet, header, mapping };

  async function save(chosen: File, selection: ImportOptions) {
    setBusy("saving"); setError("");
    try {
      const result = await (replace ? replaceMasterList : uploadMasterList)(chosen, selection);
      if (result.ok) { setMappingOpen(false); onSaved(); }
      else { setError(result.reason); setMappingOpen(true); }
    } finally { setBusy(null); }
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
        setBusy("reading"); setError(""); setPreview(null); setFile(chosen); setMappingOpen(false);
        try {
          const result = await previewMasterList(chosen);
          const first = result.sheets.find((candidate) => result.required.every((key) => candidate.mapping[key] !== undefined)) ?? result.sheets[0];
          if (!first) throw new Error("No worksheets with data were found.");
          setPreview(result); setSheet(first.name); setHeader(first.header); setMapping(first.mapping);
          const complete = result.required.every((key) => first.mapping[key] !== undefined);
          const otherTables = result.sheets.filter((candidate) => result.required.every((key) => candidate.mapping[key] !== undefined));
          if (!replace && complete && first.mappingSource === "ai" && otherTables.length === 1) {
            await save(chosen, { sheet: first.name, header: first.header, mapping: first.mapping });
          } else {
            setBusy(null); setMappingOpen(true);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not read the file."); setBusy(null);
        }
      }} />
    {error && !mappingOpen ? <p className="ic-hint ic-hint--error" role="alert">{error}</p> : null}
    {preview ? <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="muted">{sheet} · Table preview</span>
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
        <p className="ic-hint">{replace ? "Confirm the columns before replacing your current list." : "Check how your spreadsheet columns are matched."}</p>
        {missing.length ? <p className="ic-hint ic-hint--error" role="alert">Choose a column for {missing.map(columnLabel).join(" and ")} to import this file.</p> : null}
        {selected?.note ? <p className="ic-hint" role="status">{selected.note}</p> : null}
        {error ? <p className="ic-hint ic-hint--error" role="alert">{error}</p> : null}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label>Worksheet <select className="ic-select" disabled={!!busy} value={sheet} onChange={(e) => {
            const next = preview.sheets.find((candidate) => candidate.name === e.target.value)!;
            setSheet(next.name); setHeader(next.header); setMapping(next.mapping); setError("");
          }}>{preview.sheets.map((candidate) => <option key={candidate.name}>{candidate.name}</option>)}</select></label>
          <label>Header row <select className="ic-select" disabled={!!busy} value={header} onChange={(e) => {
            const next = Number(e.target.value);
            setHeader(next); setMapping(next === selected?.header ? selected.mapping : {}); setError("");
          }}>{rows.map((_, index) => <option key={index} value={index}>Row {index + 1}</option>)}</select></label>
        </div>
        <table className="ic-grid"><thead><tr><th>Master list field</th><th>Spreadsheet column</th></tr></thead>
          <tbody>{[...preview.required, ...preview.fields.filter((key) => !preview.required.includes(key))].map((field) => <tr key={field}>
            <td><label htmlFor={`mapping-${field}`}>{columnLabel(field)}{preview.required.includes(field) ? " *" : ""}</label></td>
            <td><select id={`mapping-${field}`} className="ic-select" style={{ maxWidth: "100%" }} disabled={!!busy} value={mapping[field] ?? ""} onChange={(e) => changeMapping(field, e.target.value)}>
              <option value="">{preview.required.includes(field) ? "Select column" : "Not provided"}</option>
              {columns.map((name, index) => <option key={index} value={index}>{index + 1}: {name || "Unnamed column"}</option>)}
            </select></td>
          </tr>)}</tbody>
        </table>
      </ColumnMappings>
    </> : null}
  </div>;
}
