import { describe, expect, it } from "vitest";
import { projectBox, textRotation } from "./pdfRotation";
const item = (angle: number, str = "Invoice description quantity total") => ({ str, transform: [Math.cos(angle * Math.PI / 180), Math.sin(angle * Math.PI / 180), 0, 1, 0, 0] });
describe("PDF text orientation", () => {
  it("corrects each quarter turn", () => {
    for (const angle of [0, 90, 180, 270]) expect(textRotation([item(angle)], 0)).toBe(angle);
  });
  it("does not rotate landscape pages with upright text", () => expect(textRotation([item(0)], 90)).toBe(0));
  it("preserves the OCR or PDF rotation for image-only and ambiguous pages", () => {
    expect(textRotation([], 270)).toBe(270);
    expect(textRotation([item(0), item(90)], 180)).toBe(180);
    expect(textRotation([item(90, "12")], 0)).toBe(0);
  });
});

describe("highlight rotation", () => {
  const box = { x1: 10, y1: 20, x2: 40, y2: 30 };
  it("tracks automatic rotation and successive manual quarter turns", () => {
    const cases = [
      { matrix: [1, 0, 0, -1, 0, 200], rect: { left: 10, top: 170, width: 30, height: 10 } },
      { matrix: [0, 1, 1, 0, 0, 0], rect: { left: 20, top: 10, width: 10, height: 30 } },
      { matrix: [-1, 0, 0, 1, 100, 0], rect: { left: 60, top: 20, width: 30, height: 10 } },
      { matrix: [0, -1, -1, 0, 200, 100], rect: { left: 170, top: 60, width: 10, height: 30 } },
    ];
    for (const { matrix, rect } of cases) expect(projectBox(matrix, box)).toEqual(rect);
  });
  it("scales and offsets highlights with the viewport", () => {
    expect(projectBox([0, 2, 2, 0, 5, 7], box)).toEqual({ left: 45, top: 27, width: 20, height: 60 });
  });
});
