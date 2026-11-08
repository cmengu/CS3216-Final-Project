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
  return wrappedBlockFor(m, blocks);
}


/** Match wrapped OCR descriptions without requiring identical spaces or punctuation. */
function wrappedBlockFor(m: { part: string | null; description: string }, blocks: SourceBlock[]) {
  const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const key = compact(m.description).slice(0, 40);
  if (key.length < 12) return null;
  const located = blocks.flatMap(block => block.locations.flatMap(location => {
    const b = location.bbox;
    if (!b || !location.pageHeight) return [];
    const topLeft = (b.coord_origin ?? "BOTTOMLEFT").toUpperCase() === "TOPLEFT";
    return [{ block, location, l: b.l, r: b.r,
      top: topLeft ? b.t : location.pageHeight - b.t,
      bottom: topLeft ? b.b : location.pageHeight - b.b }];
  }));
  for (const seed of located) {
    const height = seed.bottom - seed.top;
    if (height <= 0 || seed.block.kind === "table-row") continue;
    const chain = [seed];
    let text = compact(seed.block.text);
    if (!text || !key.startsWith(text.slice(0, Math.min(text.length, key.length)))) continue;
    for (let step = 0; step < 4; ++step) {
      if (text.includes(key)) {
        const bottom = Math.max(...chain.map(item => item.bottom));
        // Include quantity/pricing on the same row, but not neighbouring summary rows.
        const row = located.filter(item => item.location.page === seed.location.page
          && item.top >= seed.top - height * 0.3 && item.bottom <= bottom + height * 0.3);
        const members = [...chain, ...row];
        const block: SourceBlock = { text: chain.map(item => item.block.text).join(" "), kind: "table-row",
          locations: [{ ...seed.location, bbox: {
            l: Math.min(...members.map(item => item.l)), r: Math.max(...members.map(item => item.r)),
            t: Math.min(...members.map(item => item.top)), b: Math.max(...members.map(item => item.bottom)),
            coord_origin: "TOPLEFT",
          } }] };
        return { block, key };
      }
      const last = chain[chain.length - 1];
      const next = located.filter(item => item.location.page === seed.location.page
        && !chain.includes(item) && Math.abs(item.l - seed.l) <= height
        && item.top >= last.bottom - height * 0.2 && item.top - last.bottom <= height * 0.8
        && item.bottom - item.top <= height * 1.8)
        .sort((a, b) => a.top - b.top)[0];
      if (!next) break;
      chain.push(next);
      text += compact(next.block.text);
    }
  }
  return null;
}
