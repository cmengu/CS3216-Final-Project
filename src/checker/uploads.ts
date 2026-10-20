/*
 * The invoice upload queue. The service checks one PDF at a time, so files go one by one. Before
 * sending, a file is refused if it isn't a PDF or is over 20 MB, and skipped if the same PDF
 * (same SHA-256) was already uploaded. A busy service (429) is waited on, then tried again.
 */
"use client";

import { useSyncExternalStore } from "react";
import { rememberInvoice, uploadInvoice, UploadError } from "./api";
import type { SupplierInvoice } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;

export interface QueueItem {
  key: string;
  name: string;
  status: "waiting" | "checking";
}

export interface UploadNotice {
  key: string;
  kind: "error" | "duplicate";
  text: string;
  /** For a duplicate: the invoice already uploaded. */
  invoiceId?: string;
}

interface State {
  items: QueueItem[];
  notices: UploadNotice[];
  /** The last invoice the queue finished, so a screen can select it. */
  lastDone: SupplierInvoice | null;
  /** How many uploads finished since the page opened. */
  doneCount: number;
}

let state: State = { items: [], notices: [], lastDone: null, doneCount: 0 };
const files = new Map<string, File>();
const listeners = new Set<() => void>();
let seq = 0;
let running = false;
/** Fingerprints uploaded in this session, so a second copy in the same batch is caught too. */
const sent = new Map<string, SupplierInvoice>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const notice = (n: Omit<UploadNotice, "key">) => set({ notices: [...state.notices, { ...n, key: `n${++seq}` }] });

export function dismissNotice(key: string) {
  set({ notices: state.notices.filter((n) => n.key !== key) });
}

/** One sentence for a file refused before it is sent. Null means it may be sent. */
export function precheck(file: { name: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf")) return `${file.name} isn't a PDF.`;
  if (file.size > MAX_BYTES) return `${file.name} is over 20 MB.`;
  return null;
}

/** One sentence for an upload the service refused. */
export function refusal(name: string, e: unknown): string {
  if (!(e instanceof UploadError)) return `${name} couldn't be uploaded.`;
  if (e.status === null) return "The checking service couldn't be reached.";
  if (e.status === 415) return `${name} isn't a PDF.`;
  if (e.status === 413) return `${name} is over 20 MB.`;
  if (e.status === 422 && /page/i.test(e.detail ?? "")) return `${name} must have 1 to 30 pages.`;
  if (e.status === 422 || e.status === 400) return `${name} couldn't be read.`;
  if (e.status === 503) return "The checking service isn't ready.";
  return `${name} couldn't be uploaded.`;
}

async function sha256(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // no crypto.subtle (not a secure page): send it; the service keeps both
  }
}

const shortDate = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(known: () => SupplierInvoice[]) {
  if (running) return;
  running = true;
  try {
    while (state.items.length) {
      const item = state.items[0];
      const file = files.get(item.key)!;
      set({ items: state.items.map((x, i) => (i === 0 ? { ...x, status: "checking" } : x)) });
      const hash = await sha256(file);
      const dup = hash ? (known().find((inv) => inv.documentHash === hash) ?? sent.get(hash)) : undefined;
      if (dup) {
        notice({ kind: "duplicate", text: `You already uploaded ${dup.number ?? dup.fileName} on ${shortDate(dup.uploadedAt)}.`, invoiceId: dup.id });
      } else {
        for (;;) {
          try {
            const saved = await uploadInvoice(file);
            if (hash) sent.set(hash, saved);
            rememberInvoice(saved);
            set({ lastDone: saved, doneCount: state.doneCount + 1 });
            break;
          } catch (e) {
            if (e instanceof UploadError && e.status === 429) {
              await wait((e.retryAfter ?? 5) * 1000);
              continue;
            }
            notice({ kind: "error", text: refusal(file.name, e) });
            break;
          }
        }
      }
      files.delete(item.key);
      set({ items: state.items.slice(1) });
    }
  } finally {
    running = false;
  }
}

/** Queue files for checking. `known` lists invoices already uploaded, for the duplicate check. */
export function enqueue(list: FileList | File[], known: () => SupplierInvoice[]) {
  const add: QueueItem[] = [];
  for (const file of Array.from(list)) {
    const problem = precheck(file);
    if (problem) {
      notice({ kind: "error", text: problem });
      continue;
    }
    const key = `u${++seq}`;
    files.set(key, file);
    add.push({ key, name: file.name, status: "waiting" });
  }
  if (!add.length) return;
  set({ items: [...state.items, ...add] });
  void run(known);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const server: State = { items: [], notices: [], lastDone: null, doneCount: 0 };

export function useUploads(): State {
  return useSyncExternalStore(subscribe, () => state, () => server);
}
