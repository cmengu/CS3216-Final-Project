import { describe, expect, it } from "vitest";
import { SAMPLE_INVOICES } from "./sample";
import {
  amount,
  failure,
  invoiceLabel,
  invoiceMeta,
  lineOver,
  overcharge,
  overchargeBox,
  pileOf,
  problemsFirst,
  resultLabel,
  sheetName,
  summarize,
  supersededBy,
  unitPrice,
  uploadedLabel,
} from "./summary";
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
    expect(invoiceLabel(byId("kp-0931"))).toEqual(["l-warn", "Pending"]);
    expect(invoiceLabel(byId("bv-77810"))).toEqual(["l-good", "All match"]);
    expect(invoiceLabel(byId("tk-2210"))).toEqual(["l-info", "Checking…"]);
  });
  it("says how many lines need a look", () => {
    expect(invoiceMeta(byId("acme-0412"))).toBe("4 of 7 lines need a look");
    expect(invoiceMeta(byId("bv-77810"))).toBe("4 lines");
  });
  it("puts a PDF the service could not finish on its own pile, named for the step that failed", () => {
    const failed: SupplierInvoice = { ...byId("tk-2210"), state: "failed" };
    expect(pileOf(failed)).toBe("failed");
    expect(invoiceLabel({ ...failed, error: "reading: OCR worker failed (exit 1)" })[1]).toBe("Could not read");
    expect(invoiceLabel({ ...failed, error: "checking: Price sheet has no row" })[1]).toBe("Could not check");
    expect(invoiceLabel(failed)[1]).toBe("Could not check");
  });
  it("never calls an invoice a match when the service would not stand behind its total", () => {
    const uncertain: SupplierInvoice = { ...byId("bv-77810"), overchargeTotal: null, warnings: ["Invoice arithmetic does not reconcile"] };
    expect(pileOf(uncertain)).toBe("look");
    expect(invoiceLabel(uncertain)).toEqual(["l-warn", "Pending"]);
    expect(invoiceMeta(uncertain)).toBe("Invoice arithmetic does not reconcile");
  });
});

describe("summarize", () => {
  const s = summarize(SAMPLE_INVOICES);
  it("totals the overcharge per currency and counts the invoices it comes from", () => {
    expect(s.over).toEqual([["SGD", 170.2]]);
    expect(s.overInvoices).toBe(2);
  });
  it("puts every undecided invoice in To decide, newest first, whatever the check found", () => {
    expect(s.piles.decide.map((i) => i.id)).toEqual(["tk-2210", "acme-0412", "bv-77810", "kp-0931", "qs-00451", "acme-0398"]);
    expect(s.piles.done).toEqual([]);
  });
  it("puts a decided invoice in Done, newest decision first", () => {
    const decided = SAMPLE_INVOICES.map((inv) =>
      inv.id === "bv-77810"
        ? { ...inv, outcome: "ready_to_pay" as const, decidedAt: "2026-10-02T09:00:00Z" }
        : inv.id === "acme-0398"
          ? { ...inv, outcome: "ready_to_pay" as const, decidedAt: "2026-10-03T09:00:00Z" }
          : inv,
    );
    const t = summarize(decided);
    expect(t.piles.done.map((i) => i.id)).toEqual(["acme-0398", "bv-77810"]);
    expect(t.piles.decide.map((i) => i.id)).toEqual(["tk-2210", "acme-0412", "kp-0931", "qs-00451"]);
    expect(pileOf(byId("bv-77810"))).toBe("match");
  });
  it("counts the invoices checked in full apart from those it cannot speak for", () => {
    expect([s.known, s.unknown]).toEqual([5, 1]);
  });
  it("is empty for no invoices", () => {
    expect(summarize([])).toEqual({ over: [], overInvoices: 0, known: 0, unknown: 0, piles: { decide: [], done: [] } });
  });
  it("sets a failed attempt aside once the same PDF was sent again", () => {
    const first: SupplierInvoice = { ...byId("tk-2210"), id: "a", state: "failed", documentHash: "h", uploadedAt: "2026-10-11T09:00:00Z" };
    const again: SupplierInvoice = { ...byId("bv-77810"), id: "b", documentHash: "h", uploadedAt: "2026-10-11T09:05:00Z" };
    expect(supersededBy(first, [first, again])?.id).toBe("b");
    expect(supersededBy(again, [first, again])).toBeNull();
    const t = summarize([first, again]);
    expect(t.piles.decide.map((i) => i.id)).toEqual(["b"]);
  });
  it("keeps a failed attempt someone already decided on, even after the PDF was sent again", () => {
    const first: SupplierInvoice = { ...byId("tk-2210"), id: "a", state: "failed", documentHash: "h", uploadedAt: "2026-10-11T09:00:00Z" };
    const paid: SupplierInvoice = { ...first, outcome: "ready_to_pay_anyway", outcomeReason: "Checked by hand", decidedAt: "2026-10-11T09:02:00Z" };
    const again: SupplierInvoice = { ...byId("bv-77810"), id: "b", documentHash: "h", uploadedAt: "2026-10-11T09:05:00Z" };
    expect(supersededBy(paid, [paid, again])).toBeNull();
    expect(summarize([paid, again]).piles.done.map((i) => i.id)).toEqual(["a"]);
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

describe("uploadedLabel", () => {
  const now = new Date(2026, 9, 11, 15, 0);

  it("reads the upload time against the reader's own clock, not the sample day", () => {
    expect(uploadedLabel(new Date(2026, 9, 11, 9, 5).toISOString(), now)).toBe("Today 09:05");
    expect(uploadedLabel(new Date(2026, 9, 10, 23, 50).toISOString(), now)).toBe("Yesterday");
    expect(uploadedLabel(new Date(2026, 8, 25, 12, 0).toISOString(), now)).toMatch(/^25 Sep/);
    expect(uploadedLabel("not a time", now)).toBe("");
  });
});

describe("failure", () => {
  it("says in plain words which step failed, and keeps the service's own words out of the sentence", () => {
    const failed = { ...SAMPLE_INVOICES[0], state: "failed" as const };
    expect(failure({ ...failed, error: "reading: No readable text or tables" })).toBe("The text in this PDF could not be read.");
    expect(failure({ ...failed, error: "checking: Checker must return a result" })).toBe(
      "The invoice was read, but its lines could not be checked against the price sheet.",
    );
    expect(failure({ ...failed, error: "The service sent a status this screen does not know: queued" })).toBe(
      "The checking service could not finish this invoice.",
    );
    expect(failure(failed)).toBe("The checking service did not say what went wrong.");
  });
});

describe("overchargeBox", () => {
  const box = (over: [string, number][], overInvoices: number, known: number, unknown: number) =>
    overchargeBox({ over, overInvoices, known, unknown, piles: { decide: [], done: [] } });

  it("never says none was found when nothing was checked in full", () => {
    expect(box([], 0, 0, 12)).toEqual({ value: "Not known yet", note: "12 invoices not checked in full", found: false });
  });
  it("names the invoices it cannot speak for beside what it found", () => {
    expect(box([["USD", 22]], 1, 3, 12)).toEqual({ value: "USD 22.00", note: "on 1 invoice · 12 invoices not checked in full", found: true });
    expect(box([], 0, 3, 1)).toEqual({ value: "None found", note: "in 3 invoices checked in full · 1 invoice not checked in full", found: false });
  });
  it("says none was found only about invoices checked in full", () => {
    expect(box([], 0, 4, 0)).toEqual({ value: "None found", note: "in all 4 invoices", found: false });
    expect(box([], 0, 0, 0)).toEqual({ value: "Nothing yet", note: "Upload a PDF to check it", found: false });
  });
});

describe("resultLabel and sheetName", () => {
  it("says which way a price mismatch goes", () => {
    expect(resultLabel(line({ result: "price_mismatch", difference: 0.02 }))).toEqual(["l-bad", "Over sheet price"]);
    expect(resultLabel(line({ result: "price_mismatch", difference: -0.05 }))).toEqual(["l-warn", "Under sheet price"]);
    expect(resultLabel(line({ result: "unknown_part" }))).toEqual(["l-bad", "Unknown"]);
  });
  it("shortens a price sheet fingerprint and keeps a name", () => {
    expect(sheetName("83f0560805227ca1e5c253659194423b4f69ff9e7015256110fca148a75cfd51")).toBe("price sheet 83f05608");
    expect(sheetName("master_prices.csv")).toBe("master_prices.csv");
    expect(sheetName(null)).toBe("the price sheet");
  });
});
