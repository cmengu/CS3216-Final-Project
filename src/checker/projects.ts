"use client";

import { useCallback, useEffect, useState } from "react";
import { SERVICE_URL, sessionHeaders } from "./api";
import type { MasterList, MasterListEvent } from "@/masterList";

export interface Project {
  id: string;
  name: string;
  comparison_mode: "master_list" | "totals_only";
  created_at: string;
  has_master_list: boolean;
  invoice_count: number;
  included_count: number;
  excluded_count: number;
  totals: Record<string, string>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...options, credentials: "include", cache: "no-store",
    headers: sessionHeaders(options?.headers as Record<string, string> | undefined),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not load projects.");
  return body;
}

export function projectsChanged() { window.dispatchEvent(new Event("projects-changed")); }

export async function createProject(name: string, comparison_mode: Project["comparison_mode"]) {
  const project = await request<Project>("/projects", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, comparison_mode }),
  });
  projectsChanged();
  return project;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    window.addEventListener("projects-changed", reload);
    window.addEventListener("focus", reload);
    return () => { window.removeEventListener("projects-changed", reload); window.removeEventListener("focus", reload); };
  }, [reload]);
  useEffect(() => {
    let active = true;
    request<Project[]>("/projects").then((data) => {
      if (active) { setProjects(data); setError(null); setLoading(false); }
    }, (err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [revision]);
  return { projects, error, loading, reload };
}

export function useProjectMaster(projectId: string | null) {
  const [state, setState] = useState<{ id: string; master: MasterList | null; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = () => { setRevision((r) => r + 1); projectsChanged(); };
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    request<MasterList | null>(`/master-list?project_id=${encodeURIComponent(projectId)}`).then(
      (master) => { if (active) setState({ id: projectId, master, error: null }); },
      (err) => { if (active) setState({ id: projectId, master: null, error: err.message }); },
    );
    return () => { active = false; };
  }, [projectId, revision]);
  return { masterList: state?.id === projectId ? state.master : null,
    error: state?.id === projectId ? state.error : null,
    loading: !!projectId && state?.id !== projectId, reload };
}

export function useProjectEvents(projects: Project[]) {
  const [events, setEvents] = useState<MasterListEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all(projects.map((p) => request<MasterListEvent[]>(`/master-list/events?project_id=${encodeURIComponent(p.id)}`)))
      .then((lists) => { if (active) { setEvents(lists.flat()); setError(null); } },
        () => { if (active) setError("Could not load project master-list history."); });
    return () => { active = false; };
  }, [projects]);
  return { events, error };
}
