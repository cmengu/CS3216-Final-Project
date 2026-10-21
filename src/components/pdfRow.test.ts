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
