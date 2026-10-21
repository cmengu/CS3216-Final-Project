"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SERVICE_URL } from "@/checker/api";
import type { MasterItem } from "./parse";
export type { MasterItem } from "./parse";
export interface MasterList {
  id: string; version: string; file: string; uploadedAt: string;
  items: MasterItem[]; supplierCount: number;
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
function emit() { listeners.forEach((listener) => listener()); }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVICE_URL}/master-list${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Master list request failed.");
  return data;
}
export function getMasterList() { return cached; }
export function getMasterListEvents() { return events; }
export function refreshMasterList(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all([api<MasterList | null>(""), api<MasterListEvent[]>("/events")]).then(([list, history]) => {
    events = history; cached = list; error = null;
  }).catch(() => { error = "Could not load the master list. Check the backend connection and retry."; }).finally(() => { loading = null; emit(); });
  return loading;
}
export async function previewMasterList(file: File): Promise<ImportPreview> {
  const body = new FormData(); body.append("file", file);
  return api<ImportPreview>("/preview", { method: "POST", body });
}
async function save(file: File, method: "POST" | "PUT", options?: ImportOptions): Promise<UploadResult> {
  try {
    const body = new FormData(); body.append("file", file);
    if (options) body.append("options", JSON.stringify(options));
    const list = await api<MasterList>("", { method, body });
    // Update the table immediately even if fetching the audit trail later fails.
    cached = list; error = null;
    try { events = await api<MasterListEvent[]>("/events"); } catch { /* saved list is authoritative */ }
    emit();
    return { ok: true, list };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not upload the master list." };
  }
}
export const uploadMasterList = (file: File, options?: ImportOptions) => save(file, "POST", options);
export const replaceMasterList = (file: File, options?: ImportOptions) => save(file, "PUT", options);
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useMasterList() {
  useEffect(() => { void refreshMasterList(); }, []);
  return useSyncExternalStore(subscribe, getMasterList, () => undefined);
}
export function useMasterListError() {
  return useSyncExternalStore(subscribe, () => error, () => null);
}
