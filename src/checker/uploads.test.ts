import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierInvoice } from "./types";
import { enqueue, precheck, resetUploadsSession, useUploads } from "./uploads";
import { uploadInvoiceBatch, rememberInvoice } from "./api";
import { unpackInvoices } from "./archives";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("./api", () => ({ uploadInvoiceBatch: vi.fn(), rememberInvoice: vi.fn(), UploadError: class extends Error {} }));
vi.mock("./archives", () => ({ unpackInvoices: vi.fn() }));
const file = (name: string, content = name) => new File([content], name);
const saved = (name: string) => ({ id: name, fileName: name, uploadedAt: "2026-10-30" }) as SupplierInvoice;

beforeEach(() => {
  resetUploadsSession();
  vi.clearAllMocks();
  vi.mocked(uploadInvoiceBatch).mockImplementation(async (invoices) => ({ id: "batch", invoices: invoices.map(invoice => saved(invoice.name)), duplicates: [] }));
});

describe("invoice uploads", () => {
  it("accepts PDF/XML and ZIP/RAR with the correct size limits", () => {
    for (const name of ["demo.pdf", "demo.XML", "demo.ZIP", "demo.rar"]) expect(precheck({ name, size: 20 })).toBeNull();
    expect(precheck({ name: "demo.zip", size: 51 * 1024 * 1024 })).toContain("50 MB");
    expect(precheck({ name: "demo.xml", size: 21 * 1024 * 1024 })).toContain("20 MB");
    expect(precheck({ name: "demo.txt", size: 1 })).toContain("isn't a PDF, XML, ZIP or RAR");
  });
  it("unpacks archives and uploads every invoice in one durable batch", async () => {
    vi.mocked(unpackInvoices).mockResolvedValue({ files: [file("one.xml"), file("two.pdf")], skipped: 1 });
    enqueue([file("invoices.rar"), file("three.pdf")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(3));
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
    expect(vi.mocked(uploadInvoiceBatch).mock.calls.flatMap(([files]) => files.map(file => file.name))).toEqual(["one.xml", "two.pdf", "three.pdf"]);
    expect(useUploads().notices[0].text).toContain("skipped 1");
    expect(useUploads().items).toEqual([]);
  });
  it("reports corrupt archives and continues checking the next file", async () => {
    vi.mocked(unpackInvoices).mockRejectedValue(new Error("The archive couldn't be unpacked."));
    enqueue([file("bad.zip"), file("valid.xml")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
    expect(useUploads().notices[0].text).toContain("bad.zip");
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
  });
  it("skips duplicate content across archives and loose files", async () => {
    vi.mocked(unpackInvoices).mockResolvedValue({ files: [file("one.pdf", "same bytes")], skipped: 0 });
    enqueue([file("batch.zip"), file("duplicate.pdf", "same bytes")], () => []);
    await vi.waitFor(() => expect(useUploads().items).toHaveLength(0));
    expect(uploadInvoiceBatch).toHaveBeenCalledOnce();
    expect(useUploads().notices[0].kind).toBe("duplicate");
  });
  it("discards extraction results when the user signs out", async () => {
    let finish!: (result: { files: File[]; skipped: number }) => void;
    vi.mocked(unpackInvoices).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    enqueue([file("batch.rar")], () => []);
    await vi.waitFor(() => expect(unpackInvoices).toHaveBeenCalledOnce());
    resetUploadsSession();
    finish({ files: [file("old-session.xml")], skipped: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploadInvoiceBatch).not.toHaveBeenCalled();
    expect(rememberInvoice).not.toHaveBeenCalled();
    expect(useUploads().items).toEqual([]);
  });
});

it("keeps an old upload response out of the next user's invoice list", async () => {
  let finish!: (receipt: { id: string; invoices: SupplierInvoice[]; duplicates: [] }) => void;
  vi.mocked(uploadInvoiceBatch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  enqueue([file("old.xml")], () => []);
  await vi.waitFor(() => expect(uploadInvoiceBatch).toHaveBeenCalledOnce());
  resetUploadsSession();
  enqueue([file("new.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  finish({ id: "old-batch", invoices: [saved("old.xml")], duplicates: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useUploads().lastDone?.fileName).toBe("new.xml");
  expect(rememberInvoice).toHaveBeenCalledTimes(1);
});


it("does not promise background processing when the complete batch was refused", async () => {
  vi.mocked(uploadInvoiceBatch).mockRejectedValueOnce(new Error("Storage allowance reached."));
  enqueue([file("one.pdf"), file("two.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().notices).toHaveLength(1));
  expect(useUploads().doneCount).toBe(0);
  expect(useUploads().notices[0]).toMatchObject({ kind: "error", text: "Storage allowance reached." });
  expect(useUploads().items).toEqual([]);
});


it("rejects an oversized complete selection before unpacking or uploading", async () => {
  const largeFiles = Array.from({ length: 6 }, (_, i) => ({ name: `invoice-${i}.pdf`, size: 20 * 1024 * 1024 }) as File);
  enqueue(largeFiles, () => []);
  await vi.waitFor(() => expect(useUploads().notices).toHaveLength(1));
  expect(useUploads().notices[0].text).toContain("100 MB");
  expect(unpackInvoices).not.toHaveBeenCalled();
  expect(uploadInvoiceBatch).not.toHaveBeenCalled();
  expect(useUploads().items).toEqual([]);
});

it("bounds accumulated expanded data across an archive and loose invoices", async () => {
  const large = (name: string) => ({ name, size: 20 * 1024 * 1024 }) as File;
  vi.mocked(unpackInvoices).mockResolvedValue({ files: Array.from({ length: 5 }, (_, i) => large(`inside-${i}.xml`)), skipped: 0 });
  enqueue([file("archive.zip"), large("loose.pdf")], () => []);
  await vi.waitFor(() => expect(useUploads().notices).toHaveLength(1));
  expect(useUploads().notices[0].text).toContain("100 MB unpacked");
  expect(uploadInvoiceBatch).not.toHaveBeenCalled();
  expect(useUploads().doneCount).toBe(0);
  expect(useUploads().items).toEqual([]);
});
