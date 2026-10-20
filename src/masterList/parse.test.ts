import { describe, expect, it } from "vitest";
import { parseCsv, readMasterCsv, supplierCount } from "./parse";
import seed from "./seed.json";

const HEAD = "key,supplier_id,supplier,po,item,description,uom,currency,unit_price,discount,tax,valid_from,valid_to";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("readMasterCsv", () => {
  it("reads the mock master list's columns", () => {
    const r = readMasterCsv(`${HEAD}\nF02|A,SUP-02,DEF Hose,PO-MOCK-02,XP025,Hose 237mm,LG,SGD,68.25,0.05,0,2026-10-01,2026-12-31\n`);
    expect(r).toEqual({
      ok: true,
      items: [
        { supplier: "DEF Hose", po: "PO-MOCK-02", item: "XP025", description: "Hose 237mm", unit: "LG", currency: "SGD", price: "68.25", discount: 0.05, validFrom: "2026-10-01", validTo: "2026-12-31" },
      ],
    });
  });

  it("names the missing column in one sentence", () => {
    expect(readMasterCsv("supplier,item,uom\nA,B,PC\n")).toEqual({ ok: false, reason: "It has no unit price column." });
    expect(readMasterCsv("item,uom,price\nB,PC,1\n")).toEqual({ ok: false, reason: "It has no supplier column." });
    expect(readMasterCsv("")).toEqual({ ok: false, reason: "The file is empty." });
    expect(readMasterCsv("supplier,item,unit,price\n")).toEqual({ ok: false, reason: "It has no rows." });
  });

  it("accepts other header wordings and percent discounts", () => {
    const r = readMasterCsv("Supplier Name,Part Number,Unit,Agreed Price,Discount\nA,P1,PC,\"1,250.00\",5%\n");
    expect(r.ok && r.items[0]).toMatchObject({ supplier: "A", item: "P1", unit: "PC", price: "1250.00", discount: 0.05 });
  });
});

describe("seed", () => {
  it("is the mock master list: 24 items from 6 suppliers", () => {
    expect(seed.items).toHaveLength(24);
    expect(supplierCount(seed.items)).toBe(6);
  });
});
