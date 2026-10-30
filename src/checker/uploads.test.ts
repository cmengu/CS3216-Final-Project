import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierInvoice } from "./types";
import { enqueue, precheck, resetUploadsSession, useUploads } from "./uploads";
import { uploadInvoice, rememberInvoice } from "./api";
import { unpackInvoices } from "./archives";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("./api", () => ({ uploadInvoice: vi.fn(), rememberInvoice: vi.fn(), UploadError: class extends Error {} }));
vi.mock("./archives", () => ({ unpackInvoices: vi.fn() }));
const file = (name: string, content = name) => new File([content], name);
const saved = (name: string) => ({ id: name, fileName: name, uploadedAt: "2026-10-30" }) as SupplierInvoice;

beforeEach(() => {
  resetUploadsSession();
  vi.clearAllMocks();
  vi.mocked(uploadInvoice).mockImplementation(async (invoice) => saved(invoice.name));
});

describe("invoice uploads", () => {
  it("accepts PDF/XML and ZIP/RAR with the correct size limits", () => {
    for (const name of ["demo.pdf", "demo.XML", "demo.ZIP", "demo.rar"]) expect(precheck({ name, size: 20 })).toBeNull();
    expect(precheck({ name: "demo.zip", size: 51 * 1024 * 1024 })).toContain("50 MB");
    expect(precheck({ name: "demo.xml", size: 21 * 1024 * 1024 })).toContain("20 MB");
    expect(precheck({ name: "demo.txt", size: 1 })).toContain("isn't a PDF, XML, ZIP or RAR");
  });
  it("unpacks archives, then checks each invoice through the usual upload API", async () => {
    vi.mocked(unpackInvoices).mockResolvedValue({ files: [file("one.xml"), file("two.pdf")], skipped: 1 });
    enqueue([file("invoices.rar"), file("three.pdf")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(3));
    expect(vi.mocked(uploadInvoice).mock.calls.map(([f]) => f.name)).toEqual(["one.xml", "two.pdf", "three.pdf"]);
    expect(useUploads().notices[0].text).toContain("skipped 1");
    expect(useUploads().items).toEqual([]);
  });
  it("reports corrupt archives and continues checking the next file", async () => {
    vi.mocked(unpackInvoices).mockRejectedValue(new Error("The archive couldn't be unpacked."));
    enqueue([file("bad.zip"), file("valid.xml")], () => []);
    await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
    expect(useUploads().notices[0].text).toContain("bad.zip");
    expect(uploadInvoice).toHaveBeenCalledOnce();
  });
  it("skips duplicate content across archives and loose files", async () => {
    vi.mocked(unpackInvoices).mockResolvedValue({ files: [file("one.pdf", "same bytes")], skipped: 0 });
    enqueue([file("batch.zip"), file("duplicate.pdf", "same bytes")], () => []);
    await vi.waitFor(() => expect(useUploads().items).toHaveLength(0));
    expect(uploadInvoice).toHaveBeenCalledOnce();
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
    expect(uploadInvoice).not.toHaveBeenCalled();
    expect(rememberInvoice).not.toHaveBeenCalled();
    expect(useUploads().items).toEqual([]);
  });
});

it("keeps an old upload response out of the next user's invoice list", async () => {
  let finish!: (invoice: SupplierInvoice) => void;
  vi.mocked(uploadInvoice).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  enqueue([file("old.xml")], () => []);
  await vi.waitFor(() => expect(uploadInvoice).toHaveBeenCalledOnce());
  resetUploadsSession();
  enqueue([file("new.xml")], () => []);
  await vi.waitFor(() => expect(useUploads().doneCount).toBe(1));
  finish(saved("old.xml"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useUploads().lastDone?.fileName).toBe("new.xml");
  expect(rememberInvoice).toHaveBeenCalledTimes(1);
});
