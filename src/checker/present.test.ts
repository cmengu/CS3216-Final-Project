import { describe, expect, it } from "vitest";
import {
  auditRows,
  checkPill,
  decision,
  exportReadyToPay,
  failureSentence,
  lineAttention,
  lineDelta,
  linesPill,
  money,
  orderedLines,
  payAnywayLine,
  queueAttention,
  raiseEmail,
  statusPill,
  taxLabel,
} from "./present";
import type { InvoiceLine, SupplierInvoice } from "./types";

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  part: "P1",
  description: "Hose, 195mm",
  quantity: 18,
  unitPrice: 72.4,
  lineTotal: 1303.2,
  result: "match",
  sheetPrice: 72.4,
  difference: 0,
  reason: "",
  overcharge: 0,
  unit: "LG",
  ...over,
});

const inv = (over: Partial<SupplierInvoice>): SupplierInvoice => ({
  id: "i1",
  fileName: "F02.pdf",
  uploadedAt: "2026-10-19T08:00:00",
  state: "checked",
  supplier: "DEF Hose Company Pte Ltd",
  number: "MOCK-F02-002",
  date: "2026-10-19",
  currency: "SGD",
  subtotal: 3213.09,
  tax: 289.18,
  total: 3502.27,
  lines: [line({})],
  priceSheet: "abc",
  overchargeTotal: 0,
  purchaseOrder: "PO-MOCK-02",
  taxRate: 0.09,
  ...over,
});

const over = line({ part: "XP025-237", description: "Hose, 237mm", quantity: 28, unitPrice: 74.25, sheetPrice: 68.25, difference: 6, overcharge: 159.6, result: "price_mismatch" });
const under = line({ quantity: 4, unitPrice: 10, sheetPrice: 15, difference: -5, overcharge: 0, result: "price_mismatch" });

describe("statuses", () => {
  it("names the check result, then the outcome once decided", () => {
    expect(checkPill(inv({}))).toEqual({ text: "Matches", tone: "good" });
    expect(checkPill(inv({ lines: [over, line({})], overchargeTotal: 159.6 }))).toEqual({ text: "1 out of 2 differs", tone: "warn" });
    expect(checkPill(inv({ lines: [line({ result: "unknown_part" })] }))).toEqual({ text: "Not on master list", tone: "warn" });
    expect(checkPill(inv({ lines: [line({ result: "needs_person", reason: "Line total doesn't add up" })], overchargeTotal: null }))).toEqual({ text: "Needs you", tone: "warn" });
    expect(checkPill(inv({ state: "failed", error: "reading: x" }))).toEqual({ text: "Couldn't read", tone: "warn" });
    expect(checkPill(inv({ state: "checking" }))).toEqual({ text: "Checking…", tone: "neutral" });
    expect(statusPill(inv({ outcome: "ready_to_pay_anyway" }))).toEqual({ text: "Paid anyway", tone: "neutral" });
  });

  it("maps each failed step to one sentence", () => {
    expect(failureSentence(inv({ state: "failed", error: "reading: no text" }))).toBe("The file couldn't be read.");
    expect(failureSentence(inv({ state: "failed", error: "extracting: x" }))).toBe("The invoice details couldn't be found.");
    expect(failureSentence(inv({ state: "failed", error: "checking: x" }))).toBe("The lines couldn't be checked.");
  });
});

describe("queue and line wording", () => {
  it("says how much over or under", () => {
    expect(queueAttention(inv({ lines: [over, line({})], overchargeTotal: 159.6 }))).toBe("SGD 159.60 over");
    expect(queueAttention(inv({ lines: [under] }))).toBe("SGD 20.00 under");
    expect(queueAttention(inv({ lines: [over], overchargeTotal: null }))).toBe("SGD 159.60 over");
    expect(queueAttention(inv({ currency: "USD", lines: [line({ result: "price_mismatch", difference: 3, overcharge: 36 })], overchargeTotal: null }))).toBe("USD 36.00 over");
    expect(queueAttention(inv({ lines: [line({ ...over, overcharge: null })], overchargeTotal: null }))).toBe("1 line over");
    expect(queueAttention(inv({}))).toBeNull();
  });

  it("describes a flagged line", () => {
    expect(lineAttention(over, "SGD")).toBe("SGD 6.00 more per LG than the master list");
    expect(lineDelta(over, "SGD")).toBe("SGD 159.60 over");
    expect(lineDelta(under, "SGD")).toBe("SGD 20.00 under");
    expect(lineAttention(line({ result: "needs_person", reason: "Line total doesn't add up" }), "SGD")).toBe("Line total doesn't add up");
  });

  it("puts flagged lines first and keeps line numbers", () => {
    const i = inv({ lines: [line({}), over] });
    expect(orderedLines(i).map((x) => x.n)).toEqual([2, 1]);
    expect(linesPill(i)).toEqual({ text: "1 out of 2 differs", tone: "warn" });
    expect(linesPill(inv({}))).toEqual({ text: "1 match", tone: "good" });
  });

  it("formats money and tax", () => {
    expect(money(3502.27, "SGD")).toBe("SGD 3,502.27");
    expect(taxLabel(0.09)).toBe("Tax 9%");
    expect(taxLabel(9)).toBe("Tax 9%");
  });
});

describe("decision", () => {
  it("offers only what the service accepts", () => {
    expect(decision(inv({})).mode).toBe("pay");
    expect(decision(inv({ lines: [over, line({})], overchargeTotal: 159.6 }))).toEqual({ mode: "raise", title: "SGD 159.60 over", sub: "1 line above the master list" });
    expect(decision(inv({ lines: [under] }))).toMatchObject({ mode: "anyway", title: "SGD 20.00 under" });
    expect(decision(inv({ state: "failed", error: "reading: x" }))).toEqual({ mode: "anyway", title: "Not checked", sub: "Try again, or pay with a reason" });
    expect(decision(inv({ overchargeTotal: null })).mode).toBe("anyway");
    expect(decision(inv({ outcome: "ready_to_pay" })).mode).toBe("decided");
  });

  it("writes the Pay anyway line", () => {
    expect(payAnywayLine(inv({ lines: [over], overchargeTotal: 159.6 }))).toBe("MOCK-F02-002 is SGD 159.60 over the master list.");
  });

  it("writes the supplier email", () => {
    const e = raiseEmail(inv({ lines: [line({}), over], overchargeTotal: 159.6 }));
    expect(e.subject).toBe("Invoice MOCK-F02-002: price above agreed rate");
    expect(e.body).toBe(
      [
        "Hello,",
        "Invoice MOCK-F02-002 dated 19 Oct 2026 (PO-MOCK-02) charges above our agreed price on 1 line.",
        "Line 2, XP025-237, Hose, 237mm\n28 LG at SGD 74.25 each. Agreed price SGD 68.25.\nOver by SGD 159.60 before tax.",
        "Please send a corrected invoice.",
        "Thank you",
      ].join("\n\n"),
    );
  });
});

describe("export and audit", () => {
  const list = [
    inv({ id: "a", outcome: "ready_to_pay", decidedAt: "2026-10-20T09:00:00Z" }),
    inv({ id: "b", number: "N2", outcome: "ready_to_pay_anyway", outcomeReason: 'Agreed, by "phone"', decidedAt: "2026-10-20T10:00:00Z" }),
    inv({ id: "c", number: "N3", outcome: "raise_with_supplier", lines: [over], overchargeTotal: 159.6, decidedAt: "2026-10-20T11:00:00Z" }),
  ];

  it("exports only ready-to-pay invoices with the agreed columns", () => {
    expect(exportReadyToPay(list).split("\r\n")).toEqual([
      "Invoice no,Supplier,Invoice date,Currency,Total,Decision,Reason,Decided at",
      "MOCK-F02-002,DEF Hose Company Pte Ltd,2026-10-19,SGD,3502.27,Ready to pay,,2026-10-20T09:00:00Z",
      'N2,DEF Hose Company Pte Ltd,2026-10-19,SGD,3502.27,Paid anyway,"Agreed, by ""phone""",2026-10-20T10:00:00Z',
      "",
    ]);
  });

  it("builds audit rows, newest first, with master list uploads", () => {
    const rows = auditRows(list, [{ kind: "uploaded", file: "master_prices.csv", at: "2026-10-20T08:00:00Z", items: 24, suppliers: 6 }]);
    expect(rows.map((r) => [r.kind, r.title, r.pill.text, r.details])).toEqual([
      ["raised", "N3", "Raise with supplier", "SGD 159.60 over"],
      ["anyway", "N2", "Paid anyway", '“Agreed, by "phone"”'],
      ["ready", "MOCK-F02-002", "Ready to pay", ""],
      ["master", "Master list", "Uploaded", "24 items · 6 suppliers"],
    ]);
  });
});
