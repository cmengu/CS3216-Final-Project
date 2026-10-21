import { describe, expect, it } from "vitest";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { invoiceLabel, lineOver, overcharge } from "./summary";

const invoice02: ServiceInvoice = {
  id: "11111111-1111-1111-1111-111111111111",
  filename: "invoice-02.pdf",
  status: "completed",
  mode: "fixture",
  created_at: "2026-10-11T05:00:00+00:00",
  price_sheet_version: "83f0560805227ca1e5c253659194423b4f69ff9e7015256110fca148a75cfd51",
  error: null,
  invoice: {
    supplier_name: "Invented Silicon Trading",
    invoice_number: "DEMO-002",
    invoice_date: "2026-10-02",
    currency: "SGD",
    subtotal: "492.00",
    tax: "44.28",
    invoice_total: "536.28",
    lines: [
      { part_number: "RES-0603-10K", description: "Resistor 10k ohm 0603", quantity: "5000", unit_price: "0.015", line_total: "75.00" },
      { part_number: "CAP-0402-100N", description: "Ceramic capacitor 100nF 0402", quantity: "10000", unit_price: "0.0047", line_total: "47.00" },
      { part_number: "IC-LDO-33", description: "Voltage regulator 3.3V SOT-23", quantity: "2000", unit_price: "0.185", line_total: "370.00" },
    ],
  },
  check: {
    overcharge_total: "15.00",
    lines: [
      { line_index: 0, status: "price_mismatch", reason: "Billed unit price differs from agreed price", invoice_price: "0.015", agreed_price: "0.012", difference: "0.003", overcharge: "15.00" },
      { line_index: 1, status: "match", reason: "Agreed unit price", invoice_price: "0.0047", agreed_price: "0.0047", difference: "0", overcharge: "0.00" },
      { line_index: 2, status: "match", reason: "Agreed unit price", invoice_price: "0.185", agreed_price: "0.185", difference: "0", overcharge: "0.00" },
    ],
    warnings: [],
  },
};

/** Lines 1, 4 and 5 of the live check of data/mock_invoice_dataset/invoices/F01_freight_tax_01.pdf, as the service returned them. */
const freight01: ServiceInvoice = {
  id: "22222222-2222-2222-2222-222222222222",
  filename: "F01_freight_tax_01.pdf",
  status: "completed",
  mode: "live",
  created_at: "2026-10-21T12:40:00+00:00",
  price_sheet_version: "4bf0172b6038979be94a475804dd17ebc001c0e6efe0b8aa1a05b8a55714f05e",
  error: null,
  invoice: {
    supplier_name: "ABC Logistics Pte Ltd",
    invoice_number: "MOCK-F01-001",
    invoice_date: "2026-10-05",
    currency: "SGD",
    subtotal: "642.75",
    tax: "0.00",
    invoice_total: "642.75",
    lines: [
      // Printed as "2.40 M3 @ USD 85.00 ... @ 1.310000"; the master list holds the SGD price.
      { part_number: null, description: "Freight", quantity: "2.40", unit_price: "85.00", line_total: "267.24", unit: "M3" },
      // A flat charge printed as "CNY 1,230.00 @ 0.180000": no unit price on the page.
      { part_number: null, description: "Origin Local Fee", quantity: null, unit_price: null, line_total: "221.40", unit: null },
      { part_number: null, description: "Destination Delivery Inland Fuel Surcharge", quantity: null, unit_price: null, line_total: "17.25", unit: null },
    ],
  },
  check: {
    overcharge_total: "0.00",
    lines: [
      { line_index: 0, status: "match", reason: "Unit price matches agreement", invoice_price: "111.35000000", agreed_price: "111.35", difference: "0.00000000", overcharge: "0.00" },
      { line_index: 1, status: "match", reason: "Unit price matches agreement", invoice_price: "221.40", agreed_price: "221.4", difference: "0.00", overcharge: "0.00" },
      { line_index: 2, status: "match", reason: "Unit price matches agreement", invoice_price: "17.25", agreed_price: "17.25", difference: "0.00", overcharge: "0.00" },
    ],
    warnings: [],
  },
};

describe("toSupplierInvoice", () => {
  it("shows the invoice price the service compared, in the invoice's currency, not the printed foreign price", () => {
    const invoice = toSupplierInvoice(freight01);
    expect(invoice.lines.map((line) => [line.unitPrice, line.sheetPrice])).toEqual([
      [111.35, 111.35],
      [221.4, 221.4],
      [17.25, 17.25],
    ]);
  });

  it("falls back to the printed price when the service compared none", () => {
    const lines = freight01.check!.lines.map((line, index) => (index === 0 ? { ...line, status: "needs_person" as const, invoice_price: null } : line));
    const invoice = toSupplierInvoice({ ...freight01, check: { ...freight01.check!, lines, overcharge_total: null } });
    expect(invoice.lines[0].unitPrice).toBe(85);
  });

  it("shows dummy invoice 02 as one price mismatch of 15.00", () => {
    const invoice = toSupplierInvoice(invoice02);
    expect(invoice.state).toBe("checked");
    expect(invoice.fixture).toBe(true);
    expect(invoice.lines.filter((line) => line.result === "price_mismatch")).toHaveLength(1);
    expect(invoice.lines[0].sheetPrice).toBe(0.012);
    expect(invoice.lines[0].difference).toBe(0.003);
    expect(overcharge(invoice)).toBe(15);
    expect(invoice.supplier).toBe("Invented Silicon Trading");
  });

  it("claims nothing when the service claims nothing, and never adds the lines up itself", () => {
    const invoice = toSupplierInvoice({
      ...invoice02,
      mode: "live",
      check: { ...invoice02.check!, overcharge_total: null, warnings: ["Invoice arithmetic does not reconcile"] },
    });
    expect(invoice.fixture).toBe(false);
    expect(invoice.overchargeTotal).toBeNull();
    expect(overcharge(invoice)).toBe(0);
    expect(invoice.warnings).toEqual(["Invoice arithmetic does not reconcile"]);
  });

  it("shows the service's overcharge on a line, not its own multiplication", () => {
    // 0.015 x 67 is 1.005: the service rounds half up to 1.01, a browser float gives 1.00.
    const lines = invoice02.check!.lines.map((line, index) => (index === 0 ? { ...line, difference: "0.015", overcharge: "1.01" } : line));
    const invoice = toSupplierInvoice({ ...invoice02, check: { ...invoice02.check!, lines, overcharge_total: "1.01" } });
    expect(lineOver(invoice.lines[0])).toBe(1.01);
    expect(overcharge(invoice)).toBe(1.01);
  });

  it("counts a line the service could not price as nothing", () => {
    const lines = invoice02.check!.lines.map((line, index) =>
      index === 0 ? { ...line, status: "needs_person" as const, overcharge: null } : line,
    );
    const invoice = toSupplierInvoice({ ...invoice02, check: { overcharge_total: "0.00", lines, warnings: ["1 line not priced"] } });
    expect(lineOver(invoice.lines[0])).toBe(0);
    expect(invoice.warnings).toEqual(["1 line not priced"]);
    expect(invoiceLabel(invoice)[1]).toBe("Pending");
  });

  it("pairs each result with its line by the service's line number, not by position", () => {
    const lines = [...invoice02.check!.lines].reverse();
    const invoice = toSupplierInvoice({ ...invoice02, check: { ...invoice02.check!, lines } });
    expect(invoice.lines.map((line) => line.result)).toEqual(["price_mismatch", "match", "match"]);
  });

  it("never shows a line with no result as passed", () => {
    const invoice = toSupplierInvoice({ ...invoice02, check: { ...invoice02.check!, lines: invoice02.check!.lines.slice(0, 2) } });
    expect(invoice.lines[2].result).toBe("needs_person");
    expect(invoice.lines[2].reason).toBe("The check gave no result for this line.");
  });

  it("keeps the step and reason of a failed check, and names a status it does not know", () => {
    const failed = toSupplierInvoice({ ...invoice02, status: "failed", error: "reading: No readable text or tables", check: null });
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("reading: No readable text or tables");
    const odd = toSupplierInvoice({ ...invoice02, status: "queued", check: null });
    expect(odd.state).toBe("failed");
    expect(odd.error).toContain("queued");
  });

  it("maps an in-progress status to checking and a failure to failed", () => {
    expect(toSupplierInvoice({ ...invoice02, status: "extracting", invoice: null, check: null }).state).toBe("checking");
    expect(toSupplierInvoice({ ...invoice02, status: "failed" }).state).toBe("failed");
  });
});

describe("the clerk's outcome", () => {
  it("is carried from the service, and is no decision when the service does not save them yet", () => {
    const decided = toSupplierInvoice({ ...invoice02, outcome: "raise_with_supplier", outcome_reason: null, decided_at: "2026-10-15T02:00:00+00:00" });
    expect([decided.outcome, decided.outcomeReason, decided.decidedAt]).toEqual(["raise_with_supplier", null, "2026-10-15T02:00:00+00:00"]);
    expect(toSupplierInvoice(invoice02).outcome).toBeNull();
  });
  it("shows an outcome this screen does not know as no decision", () => {
    const odd = toSupplierInvoice({ ...invoice02, outcome: "paid", outcome_reason: "x", decided_at: "2026-10-15T02:00:00+00:00" });
    expect([odd.outcome, odd.outcomeReason, odd.decidedAt]).toEqual([null, null, null]);
  });
});
