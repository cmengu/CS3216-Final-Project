// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PdfView } from "./PdfView";

const pdf = vi.hoisted(() => {
  const renders: { canvas: HTMLCanvasElement; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const viewport = (rotation = 270, scale = 1): object => ({
    width: (rotation % 180 ? 842 : 595) * scale,
    height: (rotation % 180 ? 595 : 842) * scale,
    rotation, transform: [1, 0, 0, -1, 0, 842],
    clone(options: { rotation?: number; scale?: number }) {
      return viewport(options.rotation ?? rotation, options.scale ?? scale);
    },
  });
  const page = {
    rotate: 0,
    getTextContent: vi.fn(async () => ({ items: [] })),
    getViewport: vi.fn(({ rotation, scale }) => viewport(rotation, scale)),
    render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
      let finish!: () => void;
      const promise = new Promise<void>(resolve => { finish = resolve; });
      const cancel = vi.fn(); // deliberately do not settle: cancellation may finish later
      renders.push({ canvas, finish, cancel });
      return { promise, cancel };
    }),
  };
  const doc = { numPages: 1, getPage: vi.fn(async () => page) };
  const getDocument = vi.fn(() => ({ promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) }));
  return { getDocument, renders, page };
});
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }));

let root: Root;
let container: HTMLDivElement;
let draw: ReturnType<typeof vi.fn>;
const props = { url: "/scan.pdf", fileName: "scan.pdf", marks: [], blocks: [], focus: null };
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  pdf.renders.length = 0;
  pdf.getDocument.mockClear();
  draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() { queueMicrotask(this.callback); }
    disconnect() {}
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the document and manual rotation when refreshed props contain the same OCR angles", async () => {
  await act(async () => root.render(createElement(PdfView, { ...props, rotations: { 1: 270 } })));
  await flush();
  const rotate = container.querySelector<HTMLButtonElement>('[aria-label="Rotate current page clockwise"]')!;
  await act(async () => rotate.click());
  const width = container.querySelector<HTMLElement>(".ic-pdfpage")!.style.width;
  await act(async () => root.render(createElement(PdfView, { ...props, rotations: { 1: 270 } })));
  await flush();
  expect(pdf.getDocument).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLElement>(".ic-pdfpage")!.style.width).toBe(width);
});

it("does not let an obsolete render paint over the latest zoom or rotation", async () => {
  await act(async () => root.render(createElement(PdfView, { ...props, rotations: { 1: 270 } })));
  await flush();
  const first = pdf.renders[0];
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Rotate current page clockwise"]')!.click());
  await flush();
  const latest = pdf.renders.at(-1)!;
  expect(latest.canvas).not.toBe(first.canvas);
  expect(first.cancel).toHaveBeenCalled();
  await act(async () => { latest.finish(); });
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.calls[0][0]).toBe(latest.canvas);
  await act(async () => { first.finish(); });
  expect(draw).toHaveBeenCalledTimes(1);
});
