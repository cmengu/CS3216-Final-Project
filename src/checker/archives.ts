import { proxy, wrap } from "comlink";

import { MAX_ARCHIVE_BYTES, MAX_INVOICE_BYTES, MAX_SELECTION_FILES } from "./upload-formats";
const MAX_ENTRIES = MAX_SELECTION_FILES;
const TIMEOUT_MS = 60_000;

export interface ArchiveEntry {
  path: string;
  fileName: string;
  type: string;
  size: number;
  fileData?: ArrayBuffer;
}

interface ArchiveWorker {
  open(file: File, ready: () => void): Promise<void>;
  listFiles(): Promise<ArchiveEntry[]>;
  extractSingleFile(path: string): Promise<ArchiveEntry>;
  hasEncryptedData(): Promise<boolean | null>;
}

/** Validate the flat listing before extracting; never materialize archive paths as object keys. */
export function invoiceEntries(entries: ArchiveEntry[]) {
  if (entries.length > MAX_ENTRIES) throw new Error("The archive has more than 10,000 entries. Split it into smaller archives.");
  let skipped = 0;
  const invoices: ArchiveEntry[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("The archive has an invalid file size.");
    const path = entry.path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    const parts = path.split("/");
    if (entry.type === "DIR") continue;
    if (parts.some((p) => p === ".." || p === ".") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
      skipped++;
      continue;
    }
    if (parts.some((p) => p.startsWith(".") || p === "__MACOSX")) continue;
    if (paths.has(path)) throw new Error("The archive has duplicate file paths. Unpack it and upload the invoices separately.");
    paths.add(path);
    if (entry.type !== "FILE" || !/\.(pdf|xml)$/i.test(path) || entry.size > MAX_INVOICE_BYTES || entry.size === 0) {
      skipped++;
      continue;
    }
    invoices.push(entry);
  }
  return { invoices, skipped };
}

export interface InvoiceArchive {
  invoices: ArchiveEntry[];
  skipped: number;
  extract: (entry: ArchiveEntry) => Promise<File>;
  close: () => void;
}

/** Keep only the listing in memory; decode invoices when an upload batch needs them. */
export async function openInvoiceArchive(file: File, signal?: AbortSignal): Promise<InvoiceArchive> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("The archive is over 50 MB.");
  signal?.throwIfAborted();
  let worker: Worker | null = null;
  let archive: ArchiveWorker;
  let extractedCount = 0;
  let closed = false;
  const stopWorker = () => { worker?.terminate(); worker = null; };
  const close = () => { closed = true; stopWorker(); signal?.removeEventListener("abort", close); };
  signal?.addEventListener("abort", close, { once: true });

  async function timed<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) throw new DOMException("Upload cancelled", "AbortError");
    signal?.throwIfAborted();
    const active = worker!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    let onError = () => {};
    try {
      const failed = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Unpacking took too long. Split the archive into smaller files.")), TIMEOUT_MS);
        onError = () => reject(new Error("The archive reader couldn't start. Refresh the page and try again."));
        onAbort = () => reject(new DOMException("Upload cancelled", "AbortError"));
        active.addEventListener("error", onError, { once: true });
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([operation(), failed]);
    } finally {
      clearTimeout(timer);
      active.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function start() {
    signal?.throwIfAborted();
    if (closed) throw new DOMException("Upload cancelled", "AbortError");
    worker = new Worker("/archive/worker-bundle.js", { type: "module" });
    await timed(async () => {
      let ready!: () => void;
      const initialized = new Promise<void>(resolve => { ready = resolve; });
      const Remote = wrap<new (ready: () => void) => ArchiveWorker>(worker!);
      archive = await new Remote(proxy(ready));
      await initialized;
      await new Promise<void>((resolve, reject) => { archive.open(file, proxy(resolve)).catch(reject); });
    });
    extractedCount = 0;
  }

  try {
    await start();
    if (await timed(() => archive.hasEncryptedData())) throw new Error("Password-protected archives aren't supported. Remove the password and try again.");
    const { invoices, skipped } = invoiceEntries(await timed(() => archive.listFiles()));
    if (!invoices.length) throw new Error("The archive has no supported invoices. Include PDF or Vietnamese HDon XML invoices, up to 20 MB each.");
    return { invoices, skipped, close, extract: async entry => {
      try {
        // The library reopens native readers for single-file extraction. Recycle
        // regularly so their retained native state cannot grow with archive length.
        if (extractedCount >= 20) { stopWorker(); await start(); }
        const extracted = await timed(() => archive.extractSingleFile(entry.path));
        if (!extracted?.fileData || extracted.fileData.byteLength !== entry.size) throw new Error("An invoice couldn't be extracted completely. Unpack the archive and upload it separately.");
        const name = entry.path.replace(/\\/g, "/").split("/").pop()!;
        ++extractedCount;
        return new File([extracted.fileData], name, { type: /\.xml$/i.test(name) ? "application/xml" : "application/pdf" });
      } catch (error) {
        close();
        throw error;
      }
    } };
  } catch (error) {
    close();
    if (error instanceof Error && (error.name === "AbortError" || /archive|extract|invoice|Unpacking/.test(error.message))) throw error;
    throw new Error("The archive couldn't be unpacked. Check that it is a complete ZIP or RAR file without a password.");
  }
}
