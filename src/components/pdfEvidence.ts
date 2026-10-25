import type { SourceBlock } from "@/checker/types";

type Bbox = NonNullable<SourceBlock["locations"][number]["bbox"]>;
export interface TableDocument {
  page_documents?: { page_number: number; document: {
    pages?: Record<string, { size?: { width: number; height: number } }>;
    tables?: { data?: { table_cells?: { text: string; bbox?: Bbox | null; start_row_offset_idx: number; column_header?: boolean }[] } }[];
  } }[];
}

/** Retain row-level evidence from stored Docling cells instead of a whole-table box. */
export function tableRows(payload: TableDocument | undefined, rotatedPages: number[] = []): SourceBlock[] {
  return (payload?.page_documents ?? []).flatMap(({ page_number: page, document }) => {
    // Sideways recovery replaces Docling's evidence with original-coordinate OCR blocks.
    if (rotatedPages.includes(page)) return [];
    const size = Object.values(document.pages ?? {})[0]?.size;
    if (!size) return [];
    return (document.tables ?? []).flatMap((table) => {
      const rows = new Map<number, NonNullable<NonNullable<typeof table.data>["table_cells"]>>();
      for (const cell of table.data?.table_cells ?? []) {
        if (!cell.bbox) continue;
        const row = rows.get(cell.start_row_offset_idx) ?? [];
        row.push(cell);
        rows.set(cell.start_row_offset_idx, row);
      }
      return [...rows.values()].filter((cells) => !cells.some((c) => c.column_header)).map((cells) => {
        const boxes = cells.map((c) => {
          const b = c.bbox!;
          return (b.coord_origin ?? "BOTTOMLEFT").toUpperCase() === "TOPLEFT"
            ? { l: b.l, r: b.r, t: size.height - b.t, b: size.height - b.b } : b;
        });
        return { text: cells.map((c) => c.text).join(" | "), kind: "table-row" as const,
          locations: [{ page, pageWidth: size.width, pageHeight: size.height, bbox: {
            l: Math.min(...boxes.map((b) => b.l)), r: Math.max(...boxes.map((b) => b.r)),
            t: Math.max(...boxes.map((b) => b.t)), b: Math.min(...boxes.map((b) => b.b)), coord_origin: "BOTTOMLEFT",
          } }] };
      });
    });
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export function blockFor(m: { part: string | null; description: string }, blocks: SourceBlock[]) {
  const keys = [m.part, m.description.slice(0, 30)].filter((k): k is string => !!k && k.trim().length > 2).map(norm);
  for (const key of keys) {
    const candidates = blocks.filter((b) => norm(b.text).includes(key) && b.locations.some((l) => l.bbox));
    const ranked = candidates.map((block) => ({ block, score:
      (block.kind === "table-row" ? 100 : 0) +
      (norm(block.text) === key ? 20 : 0) + (/\d/.test(block.text) ? 10 : 0),
    })).sort((a, b) => b.score - a.score);
    if (ranked.length) return { block: ranked[0].block, key };
  }
  return null;
}
