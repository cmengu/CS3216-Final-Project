/** Dominant text baseline in PDF coordinates; PDF.js rotation is clockwise. */
export function textRotation(items: { str: string; transform: number[] }[], fallback: number): number {
  const votes = [0, 0, 0, 0];
  for (const item of items) {
    const weight = item.str.trim().length;
    const angle = Math.atan2(item.transform[1], item.transform[0]) * 180 / Math.PI;
    const quarter = Math.round(angle / 90);
    if (Math.abs(angle - quarter * 90) <= 12) votes[(quarter + 4) % 4] += weight;
  }
  const total = votes.reduce((a, b) => a + b, 0);
  const best = Math.max(...votes);
  return total >= 20 && best / total >= 0.7 ? votes.indexOf(best) * 90 : fallback;
}

/** Use the same PDF.js viewport transform as the canvas, including page rotation. */
export function projectBox(transform: number[], box: { x1: number; y1: number; x2: number; y2: number }) {
  const [a, b, c, d, e, f] = transform;
  const points = [[box.x1, box.y1], [box.x1, box.y2], [box.x2, box.y1], [box.x2, box.y2]]
    .map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
