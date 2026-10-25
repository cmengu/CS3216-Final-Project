"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SERVICE_URL, sessionHeaders } from "@/checker/api";
import { broadcastServiceChange, listenForServiceChanges } from "@/lib/service-sync";
import type { MasterItem } from "./parse";
export type { MasterItem } from "./parse";
export interface ColumnMapping {
  sheet: string; header: number; columns: string[]; mapping: Record<string, number>;
}
export interface MasterList {
  id: string; version: string; file: string; uploadedAt: string;
  items: MasterItem[]; supplierCount: number;
  columnMapping?: ColumnMapping;
}
export interface MasterListEvent {
  kind: "uploaded" | "replaced"; file: string; at: string; items: number; suppliers: number;
}
export type UploadResult = { ok: true; list: MasterList } | { ok: false; reason: string };
export type ImportOptions = { sheet: string; header: number; mapping: Record<string, number> };
export type ImportPreview = { sheets: { name: string; rows: string[][]; header: number; mapping: Record<string, number>; mappingSource: "ai" | "manual"; note: string }[]; fields: string[]; required: string[] };
const listeners = new Set<() => void>();
let cached: MasterList | null | undefined;
let events: MasterListEvent[] = [];
let error: string | null = null;
let loading: Promise<void> | null = null;
let readRevision = 0;
let writeRevision = 0;
let saving = false;
let refreshAfterSave = false;
let saveQueue: Promise<unknown> = Promise.resolve();
const SYNC_KEY = `ic.master-list.changed:${SERVICE_URL}`;
function emit() { listeners.forEach((listener) => listener()); }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVICE_URL}/master-list${path}`, {
    ...options, ...(sessionHeaders() ? { headers: sessionHeaders(options?.headers as Record<string, string> | undefined) } : {}), cache: "no-store", signal: options?.signal ?? AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Master list request failed.");
  return data;
}
export function getMasterList() { return cached; }
export function resetMasterListSession() {
  cached = undefined;
  events = [];
  error = null;
  loading = null;
  void refreshMasterList(true);
}
export function getMasterListEvents() { return events; }
export function refreshMasterList(force = false): Promise<void> {
  if (saving) {
    refreshAfterSave ||= force;
    return Promise.resolve();
  }
  if (loading && !force) return loading;
  const read = ++readRevision;
  const write = writeRevision;
  const current = () => read === readRevision && write === writeRevision;
  const pending = Promise.all([api<MasterList | null>(""), api<MasterListEvent[]>("/events").catch(() => null)]).then(([list, history]) => {
    if (!current()) return;
    if (history) events = history;
    cached = list; error = null;
  }).catch(() => {
    if (current()) error = "Could not load the master list. Check the backend connection and retry.";
  }).finally(() => {
    if (loading === pending) loading = null;
    if (current()) emit();
  });
  loading = pending;
  return pending;
}
export const getMasterListVersion = (version: string) => api<MasterList>(`/versions/${encodeURIComponent(version)}`);
export async function previewMasterList(file: File): Promise<ImportPreview> {
  const body = new FormData(); body.append("file", file);
  return api<ImportPreview>("/preview", { method: "POST", body, signal: AbortSignal.timeout(60_000) });
}
async function performSave(file: File, method: "POST" | "PUT", options?: ImportOptions): Promise<UploadResult> {
  saving = true;
  ++writeRevision;
  ++readRevision;
  loading = null;
  try {
    const body = new FormData(); body.append("file", file);
    if (options) body.append("options", JSON.stringify(options));
    const list = await api<MasterList>("", { method, body });
    // Update the table immediately even if fetching the audit trail later fails.
    cached = list; error = null;
    emit();
    broadcastServiceChange(SYNC_KEY, list.id);
    try { events = await api<MasterListEvent[]>("/events"); } catch { /* saved list is authoritative */ }
    emit();
    return { ok: true, list };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not upload the master list." };
  } finally {
    saving = false;
    if (refreshAfterSave) {
      refreshAfterSave = false;
      void refreshMasterList(true);
    }
  }
}
function save(file: File, method: "POST" | "PUT", options?: ImportOptions): Promise<UploadResult> {
  const pending = saveQueue.then(() => performSave(file, method, options));
  saveQueue = pending.catch(() => {});
  return pending;
}
export const uploadMasterList = (file: File, options?: ImportOptions) => save(file, "POST", options);
export const replaceMasterList = (file: File, options?: ImportOptions) => save(file, "PUT", options);
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useMasterList() {
  useEffect(() => {
    void refreshMasterList();
    return listenForServiceChanges(SYNC_KEY, () => { void refreshMasterList(true); });
  }, []);
  return useSyncExternalStore(subscribe, getMasterList, () => undefined);
}
export function useMasterListError() {
  return useSyncExternalStore(subscribe, () => error, () => null);
}
