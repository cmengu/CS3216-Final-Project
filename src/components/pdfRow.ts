export interface RowBlock {
  text: string;
  l: number;
  r: number;
  top: number;
  bottom: number;
}

/** Expand a matched detail to its numbered item, including the pricing columns. */
export function wholeItemRow(blocks: RowBlock[], match: RowBlock, line: number): RowBlock | null {
  const starts = blocks.filter((b) => /^\d+[.)]?$/.test(b.text.trim()) && b.r < match.l && b.top >= match.top);
  const start = starts.filter((b) => Number(b.text.trim().replace(/[.)]$/, "")) === line)
    .sort((a, b) => a.top - b.top)[0];
  if (!start) return null;
  // A different numbered item between the start and match makes this association unsafe.
  if (starts.some((b) => b !== start && b.top < start.bottom && b.top > match.top)) return null;
  const tolerance = Math.max(3, (start.top - start.bottom) / 2);
  const members = blocks.filter((b) => b.top <= start.top + tolerance && b.bottom >= match.bottom - tolerance && b.r >= start.l);
  if (!members.length) return null;
  return {
    text: match.text,
    l: Math.min(...members.map((b) => b.l)), r: Math.max(...members.map((b) => b.r)),
    top: Math.max(...members.map((b) => b.top)), bottom: Math.min(...members.map((b) => b.bottom)),
  };
}
