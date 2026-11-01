"use client";

import { useState } from "react";
import type { Project } from "@/checker/projects";

/** Review downloaded PDFs before uploading the selected files to the open project. */
export function ProjectAssignment({ files, project, onCancel, onSubmit }: {
  files: File[]; project: Project; onCancel: () => void;
  onSubmit: (files: File[]) => void;
}) {
  const [checked, setChecked] = useState<number[]>([]);
  const ready = project.comparison_mode === "totals_only" || project.has_master_list;
  return <div className="ic-page">
    <h1 className="ic-h1">Import Outlook invoices</h1>
    <p>Project: <strong>{project.name}</strong></p>
    <table className="ic-grid" aria-label="Select Outlook invoices"><thead><tr>
      <th><input type="checkbox" aria-label="Select all invoices" checked={files.length > 0 && checked.length === files.length} onChange={(e) => setChecked(e.target.checked ? files.map((_, index) => index) : [])} /></th>
      <th>Invoice PDF</th>
    </tr></thead><tbody>{files.map((file, index) => <tr key={index}>
      <td><input type="checkbox" aria-label={`Import ${file.name}`} checked={checked.includes(index)} onChange={(e) => setChecked((old) => e.target.checked ? [...old, index] : old.filter((i) => i !== index))} /></td>
      <td>{file.name}</td>
    </tr>)}</tbody></table>
    {!ready ? <p role="alert">Upload a master list for this project before importing invoices.</p> : null}
    <div className="ic-controls"><button className="ic-btn ic-btn--secondary" onClick={onCancel}>Cancel</button>
      <button className="ic-btn ic-btn--primary" disabled={!ready || !checked.length} onClick={() => onSubmit(files.filter((_, index) => checked.includes(index)))}>Import {checked.length} invoice{checked.length === 1 ? "" : "s"}</button>
    </div>
  </div>;
}
