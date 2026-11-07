"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SERVICE_URL, sessionHeaders } from "./api";
import type { MasterList, MasterListEvent } from "@/masterList";
import { createReadLoop } from "@/lib/read-loop";
import { listenForServiceChanges } from "@/lib/service-sync";
import { serviceReadFailure } from "@/lib/service-error";

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

export async function projectRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}${path}`, {
      ...options, credentials: "include", cache: "no-store",
      headers: sessionHeaders(options?.headers as Record<string, string> | undefined, !!options?.method && options.method !== "GET"),
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(options?.signal ? [options.signal] : [])]),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError"
      ? "The checking service took too long to respond. Try again."
      : "The checking service could not be reached. Try again.");
  }
  const body = await response.json().catch(() => undefined);
  if (!response.ok || body === undefined) throw serviceReadFailure(response, typeof body?.detail === "string" ? body.detail : "Could not load invoice groups. Try again.");
  return body;
}

export function projectsChanged() { window.dispatchEvent(new Event("projects-changed")); }

export async function createProject(name: string, comparison_mode: Project["comparison_mode"]) {
  const project = await projectRequest<Project>("/projects", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, comparison_mode }),
  });
  projectsChanged();
  return project;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reader = useRef<{ refresh: (force?: boolean) => void } | null>(null);
  const reload = useCallback(() => reader.current?.refresh(), []);
  useEffect(() => {
    const loop = createReadLoop({
      read: (signal) => projectRequest<Project[]>("/projects", { signal }),
      success: (data) => {
        setProjects(previous => JSON.stringify(previous) === JSON.stringify(data) ? previous : data);
        setError(null); setLoading(false);
      },
      failure: (err) => { setError(err instanceof Error ? err.message : "Could not load invoice groups. Try again."); setLoading(false); },
    });
    reader.current = loop;
    loop.refresh();
    const changed = () => loop.refresh(true);
    window.addEventListener("projects-changed", changed);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      loop.stop();
      reader.current = null;
      window.removeEventListener("projects-changed", changed);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [reload]);
  return { projects, error, loading, reload };
}

export function useProjectMaster(projectId: string | null) {
  const [state, setState] = useState<{ id: string; master: MasterList | null; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = () => { setRevision((r) => r + 1); projectsChanged(); };
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    projectRequest<MasterList | null>(`/master-list?project_id=${encodeURIComponent(projectId)}`).then(
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
  const [events, setEvents] = useState<(MasterListEvent & { projectId: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Invoice totals change during every batch; master-list history does not.
  const projectIds = JSON.stringify(projects.filter(project => project.comparison_mode === "master_list").map(project => project.id));
  useEffect(() => {
    const ids = JSON.parse(projectIds) as string[];
    const loop = createReadLoop({
      read: async signal => {
        const found: (MasterListEvent & { projectId: string })[] = [];
        for (const id of ids) {
          const history = await projectRequest<MasterListEvent[]>(`/master-list/events?project_id=${encodeURIComponent(id)}`, { signal });
          found.push(...history.map(event => ({ ...event, projectId: id })));
        }
        return found;
      },
      success: data => { setEvents(data); setError(null); },
      failure: () => setError("Could not load group master-list history."),
    });
    const refresh = () => loop.refresh();
    const stopSync = listenForServiceChanges(`ic.master-list.changed:${SERVICE_URL}`, refresh);
    window.addEventListener("projects-changed", refresh);
    loop.refresh();
    return () => { loop.stop(); stopSync(); window.removeEventListener("projects-changed", refresh); };
  }, [projectIds]);
  return { events, error };
}
