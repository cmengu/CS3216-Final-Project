import { describe, expect, it } from "vitest";
import { SAMPLE_INVOICES } from "./sample";
import { amount, invoiceLabel, invoiceMeta, lineOver, overcharge, pileOf, problemsFirst, summarize, unitPrice } from "./summary";
import type { InvoiceLine, SupplierInvoice } from "./types";

const byId = (id: string) => SAMPLE_INVOICES.find((i) => i.id === id)!;

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  part: "P",
  description: "Part",
  quantity: 10,
  unitPrice: 1,
  lineTotal: 10,
  result: "match",
  sheetPrice: 1,
  difference: 0,
  reason: "",
  ...over,
});

describe("lineOver", () => {
  it("is difference × quantity for a price mismatch charged above the sheet", () => {
    expect(lineOver(line({ result: "price_mismatch", difference: 0.035, quantity: 1200 }))).toBe(42);
  });
  it("is 0 for a mismatch charged below the sheet, a missing quantity, or any other result", () => {
    expect(lineOver(line({ result: "price_mismatch", difference: -0.01 }))).toBe(0);
    expect(lineOver(line({ result: "price_mismatch", difference: 0.01, quantity: null }))).toBe(0);
    expect(lineOver(line({ result: "needs_person", difference: 0.01 }))).toBe(0);
  });
});

describe("one invoice", () => {
  it("adds up the overcharge without float noise", () => {
    expect(overcharge(byId("acme-0412"))).toBe(52);
    expect(overcharge(byId("qs-00451"))).toBe(118.2);
  });
  it("labels the row by its worst problem", () => {
    expect(invoiceLabel(byId("acme-0412"))).toEqual(["l-bad", "SGD 52.00 over"]);
    expect(invoiceLabel(byId("kp-0931"))).toEqual(["l-warn", "Needs a person"]);
    expect(invoiceLabel(byId("bv-77810"))).toEqual(["l-good", "All match"]);
    expect(invoiceLabel(byId("tk-2210"))).toEqual(["l-info", "Checking…"]);
  });
  it("says how many lines need a look", () => {
    expect(invoiceMeta(byId("acme-0412"))).toBe("4 of 7 lines need a look");
    expect(invoiceMeta(byId("bv-77810"))).toBe("4 lines");
  });
  it("puts an unreadable PDF on the needs-a-look pile", () => {
    const failed: SupplierInvoice = { ...byId("tk-2210"), state: "failed" };
    expect(pileOf(failed)).toBe("look");
    expect(invoiceLabel(failed)[1]).toBe("Could not read");
  });
});

describe("summarize", () => {
  const s = summarize(SAMPLE_INVOICES);
  it("totals the overcharge per currency and counts the invoices it comes from", () => {
    expect(s.over).toEqual([["SGD", 170.2]]);
    expect(s.overInvoices).toBe(2);
  });
  it("sorts every invoice into one pile, newest first", () => {
    expect(s.piles.look.map((i) => i.id)).toEqual(["acme-0412", "kp-0931", "qs-00451"]);
    expect(s.piles.checking.map((i) => i.id)).toEqual(["tk-2210"]);
    expect(s.piles.match.map((i) => i.id)).toEqual(["bv-77810", "acme-0398"]);
  });
  it("is empty for no invoices", () => {
    expect(summarize([])).toEqual({ over: [], overInvoices: 0, piles: { look: [], checking: [], match: [] } });
  });
});

describe("problemsFirst", () => {
  it("orders price mismatches by overcharge, then needs a person, unknown parts, matches", () => {
    expect(problemsFirst(byId("acme-0412").lines).map((l) => l.part)).toEqual([
      "CON-USB-C-16P",
      "CAP-0402-100N",
      "FER-0603-600R",
      "XTL-16M-HC49",
      "RES-0603-10K",
      "IC-LM358-SOIC",
      "TVS-SMBJ5V0",
    ]);
  });
});

describe("formatting", () => {
  it("prints amounts with separators and unit prices as printed", () => {
    expect(amount(1284.5)).toBe("1,284.50");
    expect(unitPrice(0.0085)).toBe("0.0085");
    expect(unitPrice(0.35)).toBe("0.35");
  });
});
