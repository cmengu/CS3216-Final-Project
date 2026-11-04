"use client";

import { useState } from "react";
import { createProject, type Project } from "@/checker/projects";
import { Dialog } from "@/components/ui";

export function CreateProject({ onCreated, label = "+ New group", defaultMode = "totals_only" }: { onCreated: (p: Project) => void; label?: string; defaultMode?: Project["comparison_mode"] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Project["comparison_mode"]>(defaultMode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <>
    <button className="ic-btn ic-btn--secondary ic-btn--sm" onClick={() => setOpen(true)}>{label}</button>
    <Dialog open={open} title="New invoice group" onClose={() => { if (!busy) setOpen(false); }} footer={null}>
      <form style={{ display: "grid", gap: 16 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError("");
        try { const project = await createProject(name.trim(), mode); setOpen(false); setName(""); onCreated(project); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not create invoice group."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field ic-field--lead">Group name<input className="ic-input ic-input--lead" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="ic-field">Invoice handling<select className="ic-select ic-select--block" value={mode} onChange={(e) => setMode(e.target.value as Project["comparison_mode"])}>
          <option value="totals_only">No Master List</option>
          <option value="master_list">Compare with a Master List</option>
        </select></label>
        {error ? <p role="alert">{error}</p> : null}
        <button className="ic-btn ic-btn--primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create group"}</button>
      </form>
    </Dialog>
  </>;
}
