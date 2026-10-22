import { describe, expect, it } from "vitest";
import { allowed, choices, csvCell, csvName, CSV_COLUMNS, decidedLabel, disputeNote, hasNewerMasterList, invoiceDate, nextToDecide, readyToPay, readyToPayCsv } from "./review";
import type { InvoiceLine, SupplierInvoice } from "./types";

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  part: "RES-0603-10K",
  description: "Resistor 10k ohm 0603",
  quantity: 5000,
  unitPrice: 0.012,
  lineTotal: 60,
  result: "match",
  sheetPrice: 0.012,
  difference: 0,
  reason: "",
  overcharge: 0,
  ...over,
});

/** A line the service priced above the sheet: invented figures, as fixture invoice 2 has them. */
const overLine = line({ unitPrice: 0.015, lineTotal: 75, result: "price_mismatch", difference: 0.003, overcharge: 15, reason: "Billed unit price differs" });

const invoice = (over: Partial<SupplierInvoice> = {}): SupplierInvoice => ({
  id: "a",
  fileName: "invoice-01.pdf",
  uploadedAt: "2026-10-11T09:00:00Z",
  state: "checked",
  supplier: "Demo Circuit Supplies",
  number: "DEMO-001",
  date: "2026-10-01",
  currency: "SGD",
  subtotal: 477,
  tax: 42.93,
  total: 519.93,
  lines: [line(), line({ part: "IC-LDO-33" })],
  priceSheet: "sheet",
  overchargeTotal: 0,
  fixture: false,
  warnings: [],
  error: null,
  outcome: null,
  ...over,
});

const clean = invoice();
const overcharged = invoice({ id: "b", number: "DEMO-002", supplier: "Invented Silicon Trading", lines: [overLine, line()], overchargeTotal: 15 });
const failed = invoice({ id: "c", state: "failed", lines: [], overchargeTotal: null, error: "reading: No readable text or tables" });

describe("hasNewerMasterList", () => {
  const replacement = { version: "replacement", uploadedAt: "2026-10-11T10:00:00Z" };

  it("offers rechecking after a different master list is saved after the invoice", () => {
    expect(hasNewerMasterList(clean, replacement)).toBe(true);
  });

  it("does not treat legacy version differences as a new upload", () => {
    expect(hasNewerMasterList(clean, { ...replacement, uploadedAt: "2026-10-11T08:00:00Z" })).toBe(false);
    expect(hasNewerMasterList(clean, { ...replacement, uploadedAt: clean.uploadedAt })).toBe(false);
  });

  it("does not offer rechecking for the same version or missing version information", () => {
    expect(hasNewerMasterList(clean, { ...replacement, version: clean.priceSheet! })).toBe(false);
    expect(hasNewerMasterList(clean, null)).toBe(false);
    expect(hasNewerMasterList(invoice({ priceSheet: null }), replacement)).toBe(false);
    expect(hasNewerMasterList(clean, { ...replacement, uploadedAt: "invalid" })).toBe(false);
    expect(hasNewerMasterList(invoice({ uploadedAt: "invalid" }), replacement)).toBe(false);
  });

  it("does not offer rechecking for fixture, failed or unfinished invoices", () => {
    expect(hasNewerMasterList(invoice({ fixture: true }), replacement)).toBe(false);
    expect(hasNewerMasterList(failed, replacement)).toBe(false);
    expect(hasNewerMasterList(invoice({ state: "checking" }), replacement)).toBe(false);
  });
});

describe("choices", () => {
  it("offers Ready to pay only for an invoice checked in full with every line matching", () => {
    expect(choices(clean)).toEqual({ pay: true, payAnyway: false, raise: false });
    expect(choices(invoice({ overchargeTotal: null }))).toEqual({ pay: false, payAnyway: true, raise: false });
    expect(choices(invoice({ lines: [] }))).toEqual({ pay: false, payAnyway: true, raise: false });
    expect(choices(invoice({ lines: [line(), line({ result: "unknown_part", overcharge: null })] })).pay).toBe(false);
  });
  it("offers Raise with supplier only when a line is over the sheet price", () => {
    expect(choices(overcharged)).toEqual({ pay: false, payAnyway: true, raise: true });
    const under = line({ result: "price_mismatch", difference: -0.001, overcharge: 0 });
    expect(choices(invoice({ lines: [under, line()] }))).toEqual({ pay: false, payAnyway: true, raise: false });
    expect(choices(invoice({ lines: [line({ result: "price_mismatch", difference: null, overcharge: null })] })).raise).toBe(false);
  });
  it("lets a failed invoice be paid anyway, checked by hand, and offers nothing while checking", () => {
    expect(choices(failed)).toEqual({ pay: false, payAnyway: true, raise: false });
    expect(choices(invoice({ state: "checking" }))).toEqual({ pay: false, payAnyway: false, raise: false });
  });
});

describe("allowed", () => {
  it("needs a reason of 1 to 500 characters to pay anyway", () => {
    expect(allowed(overcharged, "ready_to_pay_anyway", null)).toBe(false);
    expect(allowed(overcharged, "ready_to_pay_anyway", "   ")).toBe(false);
    expect(allowed(overcharged, "ready_to_pay_anyway", "x".repeat(501))).toBe(false);
    expect(allowed(overcharged, "ready_to_pay_anyway", "Credit note agreed")).toBe(true);
    expect(allowed(clean, "ready_to_pay_anyway", "Credit note agreed")).toBe(false);
  });
  it("matches the offered choices for the other outcomes", () => {
    expect(allowed(clean, "ready_to_pay")).toBe(true);
    expect(allowed(overcharged, "ready_to_pay")).toBe(false);
    expect(allowed(overcharged, "raise_with_supplier")).toBe(true);
    expect(allowed(failed, "raise_with_supplier")).toBe(false);
  });
});

describe("nextToDecide", () => {
  const at = (id: string, uploadedAt: string, over: Partial<SupplierInvoice> = {}) => invoice({ id, uploadedAt, ...over });
  const list = [
    at("n1", "2026-10-11T12:00:00Z"),
    at("n2", "2026-10-11T11:00:00Z", { outcome: "ready_to_pay", decidedAt: "2026-10-11T12:30:00Z" }),
    at("n3", "2026-10-11T10:00:00Z", { state: "checking" }),
    at("n4", "2026-10-11T09:00:00Z"),
  ];
  it("is the next undecided invoice after this one, newest first, coming round to the top", () => {
    expect(nextToDecide(list, "n1")?.id).toBe("n4");
    expect(nextToDecide(list, "n4")?.id).toBe("n1");
    expect(nextToDecide(list, "n2")?.id).toBe("n4");
  });
  it("is nothing when no other invoice is left to decide", () => {
    expect(nextToDecide([list[0], list[1]], "n1")).toBeNull();
  });
});

describe("disputeNote", () => {
  it("lists only the lines over the sheet price, with the service's own figures and total", () => {
    expect(disputeNote(overcharged)).toBe(
      [
        "Invoice DEMO-002 from Invented Silicon Trading dated 1 Oct 2026 charges above the agreed price on 1 line:",
        "RES-0603-10K, Resistor 10k ohm 0603\n  Quantity 5,000. Charged 0.015 each, agreed 0.012 each. Over by SGD 15.00.",
        "Total charged above the agreed prices: SGD 15.00",
      ].join("\n\n"),
    );
  });
  it("never adds up a total the service would not stand behind", () => {
    const note = disputeNote({ ...overcharged, overchargeTotal: null })!;
    expect(note).toContain("The total over could not be confirmed");
    expect(note).not.toContain("Total charged");
  });
  it("shows a unit price to the decimals the service sent, and is nothing without a line over", () => {
    const fine = line({ unitPrice: 0.00475, sheetPrice: 0.0047, result: "price_mismatch", difference: 0.00005, overcharge: 0.5, quantity: 10000 });
    expect(disputeNote({ ...overcharged, lines: [fine] })).toContain("Charged 0.00475 each, agreed 0.0047 each.");
    expect(disputeNote(clean)).toBeNull();
  });
  it("names the file when no invoice number was read", () => {
    expect(disputeNote({ ...overcharged, number: null, date: null })).toMatch(/^The invoice in invoice-01\.pdf from Invented Silicon Trading charges/);
  });
});

describe("readyToPayCsv", () => {
  const paid = invoice({ id: "p1", date: "2026-10-05", total: 536.28, outcome: "ready_to_pay", decidedAt: "2026-10-11T10:00:00+00:00", fixture: true });
  const anyway = invoice({
    id: "p2",
    supplier: "Sample Components Lab, Pte",
    number: "=HYPERLINK(1)",
    date: "2026-10-02",
    total: 64222.8,
    outcome: "ready_to_pay_anyway",
    outcomeReason: 'Credit note "CN-7" agreed',
    decidedAt: "2026-10-11T11:00:00+00:00",
  });
  const raised = { ...overcharged, outcome: "raise_with_supplier" as const, decidedAt: "2026-10-11T12:00:00+00:00" };
  const undated = invoice({ id: "p3", date: null, total: null, outcome: "ready_to_pay", decidedAt: "2026-10-11T09:00:00+00:00" });

  it("holds only ready-to-pay invoices, by invoice date, undated last", () => {
    expect(readyToPay([paid, raised, undated, anyway, clean]).map((i) => i.id)).toEqual(["p2", "p1", "p3"]);
  });
  it("has the agreed columns and marks fixture invoices", () => {
    const rows = readyToPayCsv([paid, raised, anyway, undated]).split("\r\n");
    expect(rows[0]).toBe("Supplier,Number,Date,Currency,Total,Outcome,Reason,File,Decision time,Check");
    expect(CSV_COLUMNS).toHaveLength(10);
    expect(rows[1]).toBe(`"Sample Components Lab, Pte",'=HYPERLINK(1),2026-10-02,SGD,64222.80,Ready to pay anyway,"Credit note ""CN-7"" agreed",invoice-01.pdf,2026-10-11T11:00:00+00:00,Live`);
    expect(rows[2]).toBe('Demo Circuit Supplies,DEMO-001,2026-10-05,SGD,536.28,Ready to pay,,invoice-01.pdf,2026-10-11T10:00:00+00:00,"Fixture answers, not a live check"');
    expect(rows[3]).toBe("Demo Circuit Supplies,DEMO-001,,SGD,,Ready to pay,,invoice-01.pdf,2026-10-11T09:00:00+00:00,Live");
    expect(rows[4]).toBe("");
    expect(rows).toHaveLength(5);
  });
  it("is the header alone when nothing is ready to pay", () => {
    expect(readyToPayCsv([clean, raised])).toBe(CSV_COLUMNS.join(",") + "\r\n");
  });
  it("keeps decimals beyond two as the service sent them", () => {
    expect(readyToPayCsv([{ ...paid, total: 12.345 }]).split("\r\n")[1]).toContain(",12.345,");
  });
});

describe("helpers", () => {
  it("quotes and defuses CSV cells", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("+65 1234")).toBe("'+65 1234");
    expect(csvCell("-5.00", false)).toBe("-5.00");
    expect(csvCell(null)).toBe("");
  });
  it("names the file for the reader's own date", () => {
    expect(csvName(new Date(2026, 9, 5, 23, 0))).toBe("ready-to-pay-2026-10-05.csv");
  });
  it("prints an invoice date for a person, and leaves text it cannot read as it was", () => {
    expect(invoiceDate("2026-10-02")).toBe("2 Oct 2026");
    expect(invoiceDate("02/10/2026")).toBe("02/10/2026");
    expect(invoiceDate(null)).toBeNull();
  });
  it("says when an invoice was decided", () => {
    const now = new Date(2026, 9, 11, 15, 0);
    expect(decidedLabel(invoice({ decidedAt: new Date(2026, 9, 11, 10, 42).toISOString() }), now)).toBe("Decided Today 10:42");
    expect(decidedLabel(clean, now)).toBe("");
  });
});
