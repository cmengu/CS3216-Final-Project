export interface RowBlock {
  text: string;
  l: number;
  r: number;
  top: number;
  bottom: number;
}

/** Expand a matched detail to its numbered item, including the pricing columns. */
export function wholeItemRow(blocks: RowBlock[], match: RowBlock, line: number): RowBlock | null {
  const itemNumber = (b: RowBlock) => {
    const text = b.text.trim();
    const hit = /^(\d+)[.)]?$/.exec(text) ?? /^(\d+)[.)]?\s*\|/.exec(text);
    return hit ? Number(hit[1]) : null;
  };
  // A numbered row may be one wide OCR table row, rather than a standalone number.
  const numbered = blocks.filter((b) => itemNumber(b) !== null && b.l < match.l);
  const starts = numbered.filter((b) => b.top >= match.top);
  const start = starts.filter((b) => itemNumber(b) === line)
    .sort((a, b) => a.top - b.top)[0];
  if (!start) return null;
  // A different numbered item between the start and match makes this association unsafe.
  if (starts.some((b) => b !== start && b.top < start.bottom && b.top > match.top)) return null;
  const tolerance = Math.max(3, (start.top - start.bottom) / 2);
  const next = numbered.filter((b) => itemNumber(b) !== line && b.top < match.bottom)
    .sort((a, b) => b.top - a.top)[0];
  const bottom = next ? next.top + tolerance : match.bottom - tolerance;
  const members = blocks.filter((b) => b.top <= start.top + tolerance && b.bottom >= bottom && b.r >= start.l);
  if (!members.length) return null;
  return {
    text: match.text,
    l: Math.min(...members.map((b) => b.l)), r: Math.max(...members.map((b) => b.r)),
    top: Math.max(...members.map((b) => b.top)), bottom: Math.min(...members.map((b) => b.bottom)),
  };
}
