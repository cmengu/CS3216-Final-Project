import { proxy, wrap } from "comlink";

import { MAX_ARCHIVE_BYTES, MAX_INVOICE_BYTES } from "./upload-formats";
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 1000;
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
  if (entries.length > MAX_ENTRIES) throw new Error("The archive has more than 1,000 entries. Split it into smaller archives.");
  let expanded = 0;
  let skipped = 0;
  const invoices: ArchiveEntry[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("The archive has an invalid file size.");
    expanded += entry.size;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("The archive expands to over 100 MB. Split it into smaller archives.");
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

/** Unpack locally in a worker. Only the extracted invoices are sent to the checking API. */
export async function unpackInvoices(file: File, signal?: AbortSignal): Promise<{ files: File[]; skipped: number }> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("The archive is over 50 MB.");
  signal?.throwIfAborted();
  const worker = new Worker("/archive/worker-bundle.js", { type: "module" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    const failed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Unpacking took too long. Split the archive into smaller files.")), TIMEOUT_MS);
      worker.addEventListener("error", () => reject(new Error("The archive reader couldn't start. Refresh the page and try again.")), { once: true });
      onAbort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const extraction = async () => {
      let ready!: () => void;
      const initialized = new Promise<void>((resolve) => { ready = resolve; });
      // Use the library's flat worker API to avoid its object-based directory conversion.
      const Remote = wrap<new (ready: () => void) => ArchiveWorker>(worker);
      const archive = await new Remote(proxy(ready));
      await initialized;
      await new Promise<void>((resolve, reject) => {
        archive.open(file, proxy(resolve)).catch(reject);
      });
      const { invoices, skipped } = invoiceEntries(await archive.listFiles());
      if (await archive.hasEncryptedData()) throw new Error("Password-protected archives aren't supported. Remove the password and try again.");
      if (!invoices.length) throw new Error("The archive has no supported invoices. Include PDF or Vietnamese HDon XML invoices, up to 20 MB each.");
      const files: File[] = [];
      for (const entry of invoices) {
        signal?.throwIfAborted();
        const extracted = await archive.extractSingleFile(entry.path);
        if (!extracted?.fileData || extracted.fileData.byteLength !== entry.size) throw new Error("An invoice couldn't be extracted completely. Unpack the archive and upload it separately.");
        const name = entry.path.replace(/\\/g, "/").split("/").pop()!;
        files.push(new File([extracted.fileData], name, { type: /\.xml$/i.test(name) ? "application/xml" : "application/pdf" }));
      }
      return { files, skipped };
    };
    return await Promise.race([extraction(), failed]);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /archive|extract|invoice|Unpacking/.test(error.message))) throw error;
    throw new Error("The archive couldn't be unpacked. Check that it is a complete ZIP or RAR file without a password.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    worker.terminate();
  }
}
