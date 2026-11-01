import { describe, expect, it } from "vitest";
import { invoiceEntries, type ArchiveEntry } from "./archives";

const entry = (path: string, size = 12, type = "FILE"): ArchiveEntry => ({ path, fileName: path.split("/").pop()!, size, type });

describe("invoice archive validation", () => {
  it("finds PDF/XML invoices inside folders, including Unicode and uppercase extensions", () => {
    const result = invoiceEntries([entry("Tháng 1/demo.PDF"), entry("Tháng 1/demo.XML"), entry("./folder/invoice.xml"), entry("notes.txt"), entry("nested.zip")]);
    expect(result.invoices.map((e) => e.path)).toEqual(["Tháng 1/demo.PDF", "Tháng 1/demo.XML", "./folder/invoice.xml"]);
    expect(result.skipped).toBe(2);
  });
  it("does not follow links, traversal paths, hidden metadata or empty files", () => {
    const result = invoiceEntries([entry("../invoice.pdf"), entry("/invoice.pdf"), entry("C:\\invoice.pdf"), entry("alias.pdf", 1, "SYMBOLIC_LINK"), entry("__MACOSX/._invoice.pdf"), entry("empty.pdf", 0), entry("invoice.xml")]);
    expect(result.invoices.map((e) => e.path)).toEqual(["invoice.xml"]);
  });
  it("treats object prototype names as plain paths", () => {
    expect(invoiceEntries([entry("__proto__/invoice.xml"), entry("constructor/invoice.pdf")]).invoices).toHaveLength(2);
    expect(Object.prototype).not.toHaveProperty("invoice.xml");
  });
  it("rejects huge listings and expanded sizes before extraction", () => {
    expect(() => invoiceEntries(Array.from({ length: 1001 }, () => entry("invoice.xml")))).toThrow("1,000");
    expect(() => invoiceEntries([entry("large.bin", 101 * 1024 * 1024)])).toThrow("100 MB");
    expect(() => invoiceEntries([entry("bad.pdf", -1)])).toThrow("invalid file size");
  });
  it("rejects duplicate paths rather than extracting the wrong invoice twice", () => {
    expect(() => invoiceEntries([entry("same.xml"), entry("same.xml")])).toThrow("duplicate file paths");
  });
  it("skips oversized invoices while retaining other valid invoices", () => {
    const result = invoiceEntries([entry("large.pdf", 21 * 1024 * 1024), entry("small.xml")]);
    expect(result.invoices.map((e) => e.path)).toEqual(["small.xml"]);
    expect(result.skipped).toBe(1);
  });
});
