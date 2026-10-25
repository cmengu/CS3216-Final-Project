import { expect, it } from "vitest";
import { blockFor, tableRows } from "./pdfEvidence";

it("selects the Freight charge row over FREIGHT TERMS and includes all pricing cells", () => {
  const rows = tableRows({ page_documents: [{ page_number: 1, document: {
    pages: { "1": { size: { width: 834, height: 1180 } } },
    tables: [{ data: { table_cells: [
      { text: "Freight - 3.20 M3 @ USD 90.00/M3 USD 288.00 @ 1.310000", start_row_offset_idx: 1, bbox: { l: 44, r: 375, t: 659, b: 689, coord_origin: "TOPLEFT" } },
      { text: "Zero Rated", start_row_offset_idx: 1, bbox: { l: 567, r: 643, t: 659, b: 673, coord_origin: "TOPLEFT" } },
      { text: "377.28", start_row_offset_idx: 1, bbox: { l: 744, r: 792, t: 657, b: 673, coord_origin: "TOPLEFT" } },
    ] } }],
  } }] });
  const header = { text: "FREIGHT TERMS", locations: [{ page: 1, pageWidth: 834, pageHeight: 1180, bbox: { l: 45, r: 139, t: 703, b: 689 } }] };
  const found = blockFor({ part: null, description: "Freight" }, [header, ...rows]);
  expect(found?.block.kind).toBe("table-row");
  expect(found?.block.locations[0].bbox).toEqual({ l: 44, r: 792, t: 523, b: 491, coord_origin: "BOTTOMLEFT" });
});
it("does not use unrecovered table geometry on sideways OCR pages", () => {
  expect(tableRows({ page_documents: [{ page_number: 1, document: {} }] }, [1])).toEqual([]);
});
