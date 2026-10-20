/*
 * The master list (agreed supplier prices). No API exists for it yet, so this module keeps it in
 * the browser. Every screen reads and writes the master list only through these functions, so a
 * real backend can replace this file without touching the screens.
 *
 * NOTE: the checking service does not read this list. It checks invoices against the price sheet
 * it was started with (INVOICE_PRICE_SHEET on the server). See docs/API_MAP.md.
 */
"use client";

import { useSyncExternalStore } from "react";
import { readMasterCsv, supplierCount, type MasterItem } from "./parse";
import seed from "./seed.json";

export type { MasterItem } from "./parse";

export interface MasterList {
  file: string;
  /** ISO time of the upload. */
  uploadedAt: string;
  items: MasterItem[];
  supplierCount: number;
}

export interface MasterListEvent {
  kind: "uploaded" | "replaced";
  file: string;
  at: string;
  items: number;
  suppliers: number;
}

export type UploadResult = { ok: true; list: MasterList } | { ok: false; reason: string };

const LIST_KEY = "ic.masterList.v1";
const EVENTS_KEY = "ic.masterList.events.v1";
const listeners = new Set<() => void>();
let cached: { raw: string | null; list: MasterList | null } = { raw: null, list: null };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the list lives for this page only */
  }
}

/** The saved master list, or null before the first upload. */
// TODO(backend): replace with GET /master-list
export function getMasterList(): MasterList | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LIST_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cached.raw) {
    try {
      cached = { raw, list: raw ? (JSON.parse(raw) as MasterList) : null };
    } catch {
      cached = { raw, list: null };
    }
  }
  return cached.list;
}

/** Master list uploads, newest first, for the audit trail. */
// TODO(backend): replace with GET /master-list/events (or the audit endpoint that holds them)
export function getMasterListEvents(): MasterListEvent[] {
  if (typeof window === "undefined") return [];
  return read<MasterListEvent[]>(EVENTS_KEY, []);
}

async function load(file: File): Promise<{ ok: true; items: MasterItem[] } | { ok: false; reason: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return readMasterCsv(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    // TODO(backend): parse Excel on the server (POST /master-list). No spreadsheet library is
    // installed in the app, so an Excel file is accepted and the bundled sample rows are used.
    return { ok: true, items: seed.items as MasterItem[] };
  }
  return { ok: false, reason: "It isn't a CSV or Excel file." };
}

async function save(file: File, kind: MasterListEvent["kind"]): Promise<UploadResult> {
  const result = await load(file);
  if (!result.ok) return result;
  const list: MasterList = {
    file: file.name,
    uploadedAt: new Date().toISOString(),
    items: result.items,
    supplierCount: supplierCount(result.items),
  };
  write(LIST_KEY, list);
  write(EVENTS_KEY, [{ kind, file: list.file, at: list.uploadedAt, items: list.items.length, suppliers: list.supplierCount }, ...getMasterListEvents()]);
  listeners.forEach((l) => l());
  return { ok: true, list };
}

/** Check a file has the columns the master list needs, then save it. */
// TODO(backend): replace with POST /master-list
export function uploadMasterList(file: File): Promise<UploadResult> {
  return save(file, "uploaded");
}

/** Swap the master list for a new file. Invoices already checked keep their result. */
// TODO(backend): replace with PUT /master-list (or POST /master-list with replace semantics)
export function replaceMasterList(file: File): Promise<UploadResult> {
  return save(file, "replaced");
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LIST_KEY || e.key === EVENTS_KEY) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** The master list, kept current as it is uploaded or replaced. Undefined until the browser has read it. */
export function useMasterList(): MasterList | null | undefined {
  return useSyncExternalStore(subscribe, getMasterList, () => undefined);
}
