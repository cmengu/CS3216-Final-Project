import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierInvoice } from "./types";
import { enqueue, precheck, resetUploadsSession, resumeUploads, useUploads } from "./uploads";
import { batchCapacity, cachedInvoices, uploadInvoiceBatch, rememberInvoices, reloadInvoices, UploadError } from "./api";
import { openInvoiceArchive, type InvoiceArchive } from "./archives";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("./api", () => ({ batchCapacity: vi.fn(), cachedInvoices: vi.fn(), uploadInvoiceBatch: vi.fn(), rememberInvoices: vi.fn(), reloadInvoices: vi.fn(), UploadError: class extends Error {
  constructor(message: string, readonly status: number | null, readonly detail: string | null = null, readonly retryAfter: number | null = null, readonly batchLimit: number | null = null) { super(message); }
} }));
vi.mock("./archives", () => ({ openInvoiceArchive: vi.fn() }));
const file = (name: string, content = name) => new File([content], name);
const saved = (name: string) => ({ id: name, fileName: name, uploadedAt: "2026-10-30" }) as SupplierInvoice;

function opened(files: File[], skipped = 0): InvoiceArchive {
  const invoices = files.map(file => ({ path: file.name, fileName: file.name, size: file.size, type: "FILE" }));
  return { invoices, skipped, close: vi.fn(), extract: vi.fn(async entry => files[invoices.indexOf(entry)]) };
}

it("spaces busy retries after the server's minimum cooldown", async () => {
  vi.useFakeTimers();
  vi.mocked(Math.random).mockReturnValue(0.5);
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new UploadError("Busy", 503, "Busy", 5));
  enqueue([file("spaced.xml")], () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5_000);
  expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
});

beforeEach(() => {
  resetUploadsSession();
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.mocked(batchCapacity).mockReset().mockResolvedValue(500);
  vi.mocked(cachedInvoices).mockReset().mockReturnValue(null);
  vi.mocked(uploadInvoiceBatch).mockImplementation(async (invoices) => ({ id: "batch", invoices: invoices.map(invoice => saved(invoice.name)), duplicates: [] }));
});

afterEach(() => { resetUploadsSession(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("invoice uploads", () => {
  it("accepts PDF/XML and ZIP/RAR with the correct size limits", () => {
    for (const name of ["demo.pdf", "demo.XML", "demo.ZIP", "demo.rar"]) expect(precheck({ name, size: 20 })).toBeNull();
    expect(precheck({ name: "demo.zip", size: 51 * 1024 * 1024 })).toContain("50 MB");
    expect(precheck({ name: "demo.xml", size: 21 * 1024 * 1024 })).toContain("20 MB");
    expect(precheck({ name: "demo.txt", size: 1 })).toContain("isn't a PDF, XML, ZIP or RAR");
  });
  it("unpacks archives and uploads every invoice in one durable batch", async () => {
    vi.mocked(openInvoiceArchive).mockResolvedValue(opened([file("one.xml"), file("two.pdf")], 1));
    enqueue([file("invoices.rar"), file("three.pdf")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(3));
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
    expect(rememberInvoices).toHaveBeenCalledOnce();
    expect(vi.mocked(rememberInvoices).mock.calls[0][0]).toHaveLength(3);
    expect(vi.mocked(uploadInvoiceBatch).mock.calls.flatMap(([files]) => files.map(file => file.name))).toEqual(["one.xml", "two.pdf", "three.pdf"]);
    expect(useUploads().notices[0].text).toContain("skipped 1");
    expect(useUploads().items).toEqual([]);
  });
  it("reports corrupt archives and continues checking the next file", async () => {
    vi.mocked(openInvoiceArchive).mockRejectedValue(new Error("The archive couldn't be unpacked."));
    enqueue([file("bad.zip"), file("valid.xml")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
    expect(useUploads().notices[0].text).toContain("bad.zip");
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
  });
  it("skips duplicate content across archives and loose files", async () => {
    vi.mocked(openInvoiceArchive).mockResolvedValue(opened([file("one.pdf", "same bytes")]));
    enqueue([file("batch.zip"), file("duplicate.pdf", "same bytes")], () => []);
    await vi.waitFor(() => expect(useUploads().items).toHaveLength(0));
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
    expect(useUploads().notices[0].kind).toBe("duplicate");
  });
  it("discards extraction results when the user signs out", async () => {
    let finish!: (result: InvoiceArchive) => void;
    vi.mocked(openInvoiceArchive).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    enqueue([file("batch.rar")], () => []);
    await vi.waitFor(() => expect(openInvoiceArchive).toHaveBeenCalledOnce());
    resetUploadsSession();
    const source = opened([file("old-session.xml")]);
    finish(source);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploadInvoiceBatch).not.toHaveBeenCalled();
    expect(rememberInvoices).not.toHaveBeenCalled();
    expect(useUploads().items).toEqual([]);
    expect(source.close).toHaveBeenCalledOnce();
  });
});

it("keeps an old upload response out of the next user's invoice list", async () => {
  let finish!: (receipt: { id: string; invoices: SupplierInvoice[]; duplicates: [] }) => void;
  vi.mocked(uploadInvoiceBatch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  enqueue([file("old.xml")], () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  const signal = vi.mocked(uploadInvoiceBatch).mock.calls[0][2];
  resetUploadsSession();
  expect(signal?.aborted).toBe(true);
  enqueue([file("new.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  finish({ id: "old-batch", invoices: [saved("old.xml")], duplicates: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useUploads().lastDone?.fileName).toBe("new.xml");
  expect(rememberInvoices).toHaveBeenCalledTimes(1);
});


it("does not promise background processing when the complete batch was refused", async () => {
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new Error("Storage allowance reached."));
  enqueue([file("one.pdf"), file("two.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().notices).toHaveLength(1));
  expect(useUploads().doneCount).toBe(0);
  expect(useUploads().notices[0]).toMatchObject({ kind: "error", text: expect.stringContaining("Storage allowance reached."), retryUpload: true });
  expect(useUploads().items).toHaveLength(2);
  resumeUploads();
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(2));
});


it("splits a selection above 100 MiB into bounded upload requests", async () => {
  const largeFiles = Array.from({ length: 6 }, (_, i) => ({ name: `invoice-${i}.pdf`, size: 20 * 1024 * 1024 }) as File);
  enqueue(largeFiles, () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(6));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([files]) => files.reduce((size, file) => size + file.size, 0))).toEqual([100 * 1024 * 1024, 20 * 1024 * 1024]);
  expect(useUploads().items).toEqual([]);
});

it("extracts only the current upload batch from an archive larger than 100 MiB", async () => {
  const large = (name: string) => ({ name, size: 20 * 1024 * 1024 }) as File;
  const source = opened(Array.from({ length: 6 }, (_, i) => large(`inside-${i}.xml`)));
  vi.mocked(openInvoiceArchive).mockResolvedValue(source);
  let finish!: () => void;
  vi.mocked(uploadInvoiceBatch).mockImplementationOnce(async files => {
    await new Promise<void>(resolve => { finish = resolve; });
    return { id: "first", invoices: files.map(file => saved(file.name)), duplicates: [] };
  });
  enqueue([file("archive.zip"), large("loose.pdf")], () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  expect(source.extract).toHaveBeenCalledTimes(5);
  finish();
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(7));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([files]) => files.length)).toEqual([5, 2]);
  expect(source.close).toHaveBeenCalledOnce();
});

it("keeps the destination project on every invoice expanded from an archive", async () => {
  vi.mocked(openInvoiceArchive).mockResolvedValue(opened([file("one.xml"), file("two.pdf")]));
  enqueue([file("project.zip")], () => [], "project-destination");
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(2));
  expect(uploadInvoiceBatch).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: "one.xml" }), expect.objectContaining({ name: "two.pdf" })]), "project-destination", expect.any(AbortSignal));
});

it.each([1_000, 10_000])("uploads %s invoices in successive batches of at most 500", async count => {
  let active = 0;
  let maximum = 0;
  vi.mocked(uploadInvoiceBatch).mockImplementation(async invoices => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 0));
    --active;
    return { id: "batch", invoices: invoices.map(invoice => saved(invoice.name)), duplicates: [] };
  });
  enqueue(Array.from({ length: count }, (_, index) => file(`invoice-${index}.xml`)), () => [], "large-group");
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(count), { timeout: 25_000 });
  expect(uploadInvoiceBatch).toHaveBeenCalledTimes(count / 500);
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.every(([invoices, project]) => invoices.length === 500 && project === "large-group")).toBe(true);
  expect(maximum).toBe(1);
  expect(useUploads().items).toEqual([]);
}, 30_000);

it("keeps the remainder waiting until the first 500 are acknowledged", async () => {
  let finish!: (value: { id: string; invoices: SupplierInvoice[]; duplicates: [] }) => void;
  vi.mocked(uploadInvoiceBatch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  enqueue(Array.from({ length: 501 }, (_, index) => file(`invoice-${index}.xml`)), () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  expect(useUploads().items.filter(item => item.status === "uploading")).toHaveLength(500);
  expect(useUploads().items.filter(item => item.status === "waiting")).toHaveLength(1);
  finish({ id: "first", invoices: vi.mocked(uploadInvoiceBatch).mock.calls[0][0].map(invoice => saved(invoice.name)), duplicates: [] });
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(501));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([invoices]) => invoices.length)).toEqual([500, 1]);
});

it("keeps rate-limited files queued and obeys Retry-After without resending accepted files", async () => {
  vi.useFakeTimers();
  vi.mocked(uploadInvoiceBatch)
    .mockImplementationOnce(async invoices => ({ id: "first", invoices: invoices.map(invoice => saved(invoice.name)), duplicates: [] }))
    .mockRejectedValueOnce(new UploadError("Hourly allowance reached.", 429, null, 30));
  enqueue(Array.from({ length: 501 }, (_, index) => file(`invoice-${index}.xml`)), () => []);
  await vi.waitFor(() => expect(useUploads().notices.some(notice => notice.text.includes("Uploads are paused"))).toBe(true), { timeout: 30_000 });
  expect(useUploads().doneCount).toBe(500);
  expect(useUploads().items).toHaveLength(1);
  expect(useUploads().items[0].status).toBe("waiting");
  expect(uploadInvoiceBatch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(uploadInvoiceBatch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(501));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([invoices]) => invoices.length)).toEqual([500, 1, 1]);
  expect(useUploads().notices.some(notice => notice.text.includes("Uploads are paused"))).toBe(false);
  enqueue([file("another.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(502));
});

it("cancels a deferred upload when the account session changes", async () => {
  vi.useFakeTimers();
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new UploadError("Wait.", 429, null, 30));
  enqueue([file("old.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().notices.some(notice => notice.text.includes("Uploads are paused"))).toBe(true));
  resetUploadsSession();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
  enqueue([file("new.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls[1][0][0].name).toBe("new.xml");
});

it("recovers the invoice list when a timed-out upload was already accepted", async () => {
  vi.useFakeTimers();
  vi.mocked(uploadInvoiceBatch)
    .mockRejectedValueOnce(new UploadError("Gateway timeout.", 504))
    .mockResolvedValueOnce({ id: "retry", invoices: [], duplicates: [{ filename: "accepted.xml", existing_id: "saved-invoice" }] });
  enqueue([file("accepted.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().notices.some(notice => notice.text.includes("Uploads are paused"))).toBe(true));
  await vi.advanceTimersByTimeAsync(5_000);
  await vi.waitFor(() => expect(useUploads().items).toEqual([]));
  expect(reloadInvoices).toHaveBeenCalled();
  expect(useUploads().notices.some(notice => notice.kind === "duplicate" && notice.invoiceId === "saved-invoice")).toBe(true);
});

it("shrinks a batch that exceeds an account allowance instead of retrying it forever", async () => {
  vi.useFakeTimers();
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new UploadError("This batch exceeds the allowance.", 429, null, 86400, 2));
  enqueue(Array.from({ length: 5 }, (_, i) => file(`invoice-${i}.pdf`)), () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(5));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([files]) => files.length)).toEqual([5, 2, 2, 1]);
});

it("does not discard a paused queue when too many additional files are selected", async () => {
  vi.useFakeTimers();
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new UploadError("Wait", 429, null, 30));
  enqueue([file("waiting.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().notices.some(notice => notice.text.includes("Uploads are paused"))).toBe(true));
  enqueue(Array.from({ length: 10_000 }, (_, i) => file(`extra-${i}.pdf`)), () => []);
  expect(useUploads().items.map(item => item.name)).toEqual(["waiting.xml"]);
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
});

it("allows the same content to be uploaded again after its earlier check failed", async () => {
  const invoiceFile = file("retry.xml");
  const digest = await crypto.subtle.digest("SHA-256", await invoiceFile.arrayBuffer());
  const documentHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const record = { ...saved("retry.xml"), documentHash, state: "checking" as const };
  vi.mocked(uploadInvoiceBatch).mockResolvedValue({ id: "batch", invoices: [record], duplicates: [] });
  enqueue([invoiceFile], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  enqueue([invoiceFile], () => [{ ...record, state: "failed" }]);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(2));
  expect(uploadInvoiceBatch).toHaveBeenCalledTimes(2);
});

it("does not extract archive bytes while the server queue is full", async () => {
  vi.useFakeTimers();
  const source = opened([file("deferred.xml")]);
  vi.mocked(openInvoiceArchive).mockResolvedValue(source);
  vi.mocked(batchCapacity).mockRejectedValueOnce(new UploadError("Queue full", 503, null, 30, 0));
  enqueue([file("deferred.zip")], () => []);
  await vi.waitFor(() => expect(batchCapacity).toHaveBeenCalledOnce());
  expect(source.extract).not.toHaveBeenCalled();
  expect(uploadInvoiceBatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  expect(source.extract).toHaveBeenCalledOnce();
});

it("backs off during sustained busy responses even when Retry-After stays at five seconds", async () => {
  vi.useFakeTimers();
  vi.mocked(batchCapacity).mockRejectedValue(new UploadError("Busy", 503, null, 5));
  enqueue([file("waiting.xml")], () => []);
  await vi.waitFor(() => expect(batchCapacity).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(195_000);
  expect(vi.mocked(batchCapacity).mock.calls.length).toBeLessThanOrEqual(8);
  expect(uploadInvoiceBatch).not.toHaveBeenCalled();
});

it("fits uploads to available queue slots and rechecks before sending more", async () => {
  vi.mocked(batchCapacity).mockResolvedValue(2);
  enqueue(Array.from({ length: 5 }, (_, index) => file(`capacity-${index}.xml`)), () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(5));
  expect(vi.mocked(uploadInvoiceBatch).mock.calls.map(([files]) => files.length)).toEqual([2, 2, 1]);
});

it("recovers a lost receipt from the saved list even if no queue slots remain", async () => {
  vi.useFakeTimers();
  const invoiceFile = file("already-saved.xml");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await invoiceFile.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new UploadError("Receipt lost", 504));
  enqueue([invoiceFile], () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  vi.mocked(cachedInvoices).mockReturnValue([{ ...saved(invoiceFile.name), documentHash: hash, state: "checking" } as SupplierInvoice]);
  vi.mocked(batchCapacity).mockRejectedValue(new UploadError("Full", 503, null, 30, 0));
  await vi.advanceTimersByTimeAsync(5_000);
  await vi.waitFor(() => expect(useUploads().items).toHaveLength(0));
  expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
  expect(useUploads().notices.some(notice => notice.text.includes("recovered"))).toBe(true);
});
