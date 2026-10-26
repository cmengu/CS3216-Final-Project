import { expect, it } from "vitest";
import { wholeItemRow, type RowBlock } from "./pdfRow";
const block = (text: string, l: number, r: number, top: number, bottom: number): RowBlock => ({ text, l, r, top, bottom });
it("includes numbered item description and pricing through its article number", () => {
  const match = block("Article no: XYZ", 110, 310, 160, 145);
  const row = wholeItemRow([
    block("Previous item", 110, 330, 400, 385),
    block("2.", 70, 87, 373, 358),
    block("Hose description", 110, 320, 375, 358),
    block("28.0", 465, 493, 373, 358),
    block("1975.05", 718, 765, 373, 358),
    block("Fitting details", 110, 330, 300, 200), match,
    block("Footer", 100, 750, 110, 90),
  ], match, 2);
  expect(row).toEqual({ text: match.text, l: 70, r: 765, top: 375, bottom: 145 });
});
it("does not expand without a matching numbered item", () => {
  const match = block("XYZ", 100, 200, 100, 90);
  expect(wholeItemRow([], match, 2)).toBeNull();
});
it("expands a hose article number to its table-row start and stops before the next item", () => {
  const match = block("Article no.: XP025-3806-3806-000195", 109, 309, 527, 511);
  const row = wholeItemRow([
    block("No. | Description | Amount", 72, 768, 790, 770),
    block('1. | 1" XP SS Hose PIPE/TUBE IN SS316 X | DO-M01 | 18.0 | LG | 72.40 | 65.16 | 1,238.04', 72, 768, 755, 734),
    block("Stainless Steel Flexible Hose", 109, 300, 704, 689), match,
    block("Temp. Range: -196 C to +600 C", 109, 320, 490, 475),
    block("Mock Type Approved", 109, 300, 430, 415),
    block("**All tube & elbow Supplied by client**", 109, 350, 400, 385),
    block("2.", 71, 87, 373, 358),
    block("Second hose", 109, 330, 373, 358),
  ], match, 1);
  expect(row).toEqual({ text: match.text, l: 72, r: 768, top: 755, bottom: 385 });
});
