import { describe, expect, it } from "vitest";
import { xmlNumber, xmlRate } from "./xmlInvoice";

describe("original XML number display", () => {
  it("groups amounts without floating-point rounding or losing printed precision", () => {
    expect(xmlNumber("12345678901234567890.001250")).toBe("12,345,678,901,234,567,890.001250");
    expect(xmlNumber("125000.1250")).toBe("125,000.1250");
    expect(xmlNumber("-1234567.00")).toBe("-1,234,567.00");
  });
  it("distinguishes missing fields from explicit zero amounts", () => {
    expect(xmlNumber(null)).toBe("Not provided");
    expect(xmlNumber("0.00")).toBe("0.00");
  });
  it("labels numeric tax rates as percentages and preserves source tax codes", () => {
    expect(xmlRate("8")).toBe("8%");
    expect(xmlRate("8%")).toBe("8%");
    expect(xmlRate("KCT")).toBe("KCT");
    expect(xmlRate(null)).toBe("Not provided");
  });
  it("leaves unrecognized source values intact instead of guessing", () => {
    expect(xmlNumber("1.250,50")).toBe("1.250,50");
    expect(xmlNumber("Not applicable")).toBe("Not applicable");
  });
});
