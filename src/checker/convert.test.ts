import { describe, expect, it } from "vitest";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";
import { overcharge } from "./summary";

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
      { status: "price_mismatch", reason: "Billed unit price differs from agreed price", invoice_price: "0.015", agreed_price: "0.012", difference: "0.003" },
      { status: "match", reason: "Agreed unit price", invoice_price: "0.0047", agreed_price: "0.0047", difference: "0" },
      { status: "match", reason: "Agreed unit price", invoice_price: "0.185", agreed_price: "0.185", difference: "0" },
    ],
  },
};

describe("toSupplierInvoice", () => {
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

  it("records a null service total as null", () => {
    const invoice = toSupplierInvoice({
      ...invoice02,
      mode: "live",
      check: { ...invoice02.check!, overcharge_total: null },
    });
    expect(invoice.fixture).toBe(false);
    expect(invoice.overchargeTotal).toBeNull();
  });

  it("maps an in-progress status to checking and a failure to failed", () => {
    expect(toSupplierInvoice({ ...invoice02, status: "extracting", invoice: null, check: null }).state).toBe("checking");
    expect(toSupplierInvoice({ ...invoice02, status: "failed" }).state).toBe("failed");
  });
});
