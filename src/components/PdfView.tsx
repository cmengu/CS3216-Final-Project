"use client";

/*
 * The original PDF, rendered with pdf.js, with flagged lines highlighted. A highlight is placed
 * from the reader's blocks (ParsedDocument.blocks[].locations): the block whose text holds the
 * line's part number (else its description) gives the page and horizontal extent. When the PDF's
 * own text layer has that part number, the highlight is narrowed to that row; otherwise it covers
 * the block. When nothing matches, "Show" just scrolls to the line's page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { SourceBlock } from "@/checker/types";
import { wholeItemRow } from "./pdfRow";
import { projectBox, textRotation } from "./pdfRotation";
import { Icon } from "./icons";

export interface Mark {
  n: number;
  part: string | null;
  description: string;
}

interface Box {
  n: number;
  page: number;
  /** In PDF points, origin bottom-left. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type PageSize = { w: number; h: number; viewport: ReturnType<PDFPageProxy["getViewport"]> };

function screenBox(s: PageSize, b: Box) {
  return projectBox(s.viewport.transform, b);
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The block that holds this line, and where it sits. */
function blockFor(m: Mark, blocks: SourceBlock[]) {
  const keys = [m.part, m.description.slice(0, 30)].filter((k): k is string => !!k && k.trim().length > 2).map(norm);
  for (const k of keys) {
    const b = blocks.find((x) => norm(x.text).includes(k) && x.locations.some((l) => l.bbox));
    if (b) return { block: b, key: k };
  }
  return null;
}

/** Bottom-left PDF coordinates for a block location. */
function toBottomLeft(loc: SourceBlock["locations"][number]) {
  const b = loc.bbox!;
  if ((b.coord_origin ?? "BOTTOMLEFT").toUpperCase() === "TOPLEFT" && loc.pageHeight) {
    const H = loc.pageHeight;
    return { l: b.l, r: b.r, top: H - b.t, bottom: H - b.b };
  }
  return { l: b.l, r: b.r, top: b.t, bottom: b.b };
}

async function placeMarks(doc: PDFDocumentProxy, marks: Mark[], blocks: SourceBlock[]): Promise<{ boxes: Box[]; pages: Record<number, number> }> {
  const boxes: Box[] = [];
  const pages: Record<number, number> = {};
  const text = new Map<number, { str: string; x: number; y: number; w: number; h: number; angle: number }[]>();
  const items = async (p: number) => {
    if (!text.has(p)) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      text.set(
        p,
        tc.items.flatMap((it) => ("str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.hypot(it.transform[2], it.transform[3]), angle: Math.atan2(it.transform[1], it.transform[0]) }] : [])),
      );
    }
    return text.get(p)!;
  };
  for (const m of marks) {
    const found = blockFor(m, blocks);
    if (!found) continue;
    const loc = found.block.locations.find((l) => l.bbox)!;
    pages[m.n] = loc.page;
    const matched = { ...toBottomLeft(loc), text: found.block.text };
    const row = wholeItemRow(blocks.flatMap((block) => block.locations
      .filter((location) => location.page === loc.page && location.bbox)
      .map((location) => ({ ...toBottomLeft(location), text: block.text }))), matched, m.n);
    const b = row ?? matched;
    let x1 = b.l - 4;
    let x2 = b.r + 4;
    let y1 = b.bottom;
    let y2 = b.top;
    if (!row && m.part && loc.page <= doc.numPages) {
      const hit = (await items(loc.page)).find((it) => it.str.includes(m.part!) && it.y >= b.bottom - 2 && it.y <= b.top + 2 && it.x >= b.l - 2 && it.x <= b.r + 2);
      if (hit) {
        // Narrow across the text baseline, including sideways/upside-down text.
        const dx = -Math.sin(hit.angle) * hit.h;
        const dy = Math.cos(hit.angle) * hit.h;
        if (Math.abs(Math.sin(hit.angle)) > 0.9) {
          x1 = Math.min(hit.x, hit.x + dx) - 4;
          x2 = Math.max(hit.x, hit.x + dx) + 4;
        } else if (Math.abs(Math.cos(hit.angle)) > 0.9) {
          y1 = Math.min(hit.y, hit.y + dy) - 4;
          y2 = Math.max(hit.y, hit.y + dy) + 4;
        }
      }
    }
    boxes.push({ n: m.n, page: loc.page, x1, y1, x2, y2 });
  }
  return { boxes, pages };
}

export function PdfView({
  url,
  fileName,
  marks,
  blocks,
  focus,
  rotations,
}: {
  rotations?: Record<number, number>;
  url: string;
  fileName: string;
  marks: Mark[];
  blocks: SourceBlock[];
  /** The line to scroll to; seq changes on every "Show" click. */
  focus: { n: number; seq: number } | null;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(3);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [placed, setPlaced] = useState<{ boxes: Box[]; pages: Record<number, number> }>({ boxes: [], pages: {} });
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  // Load the document. The parent remounts this view for each invoice, so state starts fresh.
  useEffect(() => {
    let live = true;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loading = pdfjs.getDocument({ url });
        task = loading;
        const loaded = await loading.promise;
        if (!live) return;
        const s: PageSize[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const pg = await loaded.getPage(i);
          let rotation = (pg.rotate + (rotations?.[i] ?? 0)) % 360;
          try {
            const content = await pg.getTextContent();
            rotation = textRotation(content.items.flatMap((it) => "str" in it ? [it] : []), rotation);
          } catch { /* Image-only or damaged text: keep OCR/page rotation. */ }
          const v = pg.getViewport({ scale: 1, rotation });
          s.push({ w: v.width, h: v.height, viewport: v });
        }
        if (!live) return;
        setSizes(s);
        setDoc(loaded);
      } catch {
        if (live) setError("The PDF couldn’t be shown.");
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [url, rotations]);

  // Place highlights once the document is in.
  useEffect(() => {
    if (!doc) return;
    let live = true;
    void placeMarks(doc, marks, blocks).then((p) => {
      if (live) setPlaced(p);
    });
    return () => {
      live = false;
    };
  }, [doc, marks, blocks]);

  // Track the pane width so a page fits it at 100%.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scaleFor = useCallback((w: number) => (width ? ((width - 40) / w) * ZOOMS[zoom] : 1), [width, zoom]);

  // Render pages whenever the scale changes.
  useEffect(() => {
    if (!doc || !width) return;
    let live = true;
    const tasks: { cancel: () => void }[] = [];
    (async () => {
      for (let i = 1; i <= doc.numPages && live; i++) {
        const canvas = canvases.current[i - 1];
        if (!canvas) continue;
        const pg = await doc.getPage(i);
        const viewport = sizes[i - 1].viewport.clone({ scale: scaleFor(sizes[i - 1].w) * (window.devicePixelRatio || 1) });
        if (!live) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const task = pg.render({ canvas, viewport });
        tasks.push(task);
        await task.promise.catch(() => undefined);
      }
    })();
    return () => {
      live = false;
      tasks.forEach((t) => t.cancel());
    };
  }, [doc, width, zoom, sizes, scaleFor]);

  const goTo = useCallback((p: number, y = 0) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${p}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 20 + y, behavior: "smooth" });
  }, []);

  // "Show →": scroll to the highlight, or to its page.
  useEffect(() => {
    if (!focus || !doc) return;
    const box = placed.boxes.find((b) => b.n === focus.n);
    if (box) {
      const s = sizes[box.page - 1];
      const scale = scaleFor(s.w);
      goTo(box.page, Math.max(0, screenBox(s, box).top * scale - 80));
    } else if (placed.pages[focus.n]) goTo(placed.pages[focus.n]);
  }, [focus, doc, placed, sizes, goTo, scaleFor]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const pages = [...el.querySelectorAll<HTMLElement>("[data-page]")];
    const mid = el.scrollTop + el.clientHeight / 3;
    const at = pages.findLast((p) => p.offsetTop <= mid);
    if (at) setPage(Number(at.dataset.page));
  };

  const n = doc?.numPages ?? 0;
  return (
    <section className="ic-doc" aria-label="Invoice PDF">
      <div className="ic-doc-bar">
        <span className="name" title={fileName}>
          {fileName}
        </span>
        <span className="sp" />
        <button className="ic-icobtn" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          <Icon name="chevL" />
        </button>
        <span className="num" aria-live="polite">
          {n ? `Page ${page} of ${n}` : "Loading…"}
        </span>
        <button className="ic-icobtn" type="button" aria-label="Next page" disabled={!n || page >= n} onClick={() => goTo(page + 1)}>
          <Icon name="chev" />
        </button>
        <span className="sep" aria-hidden="true" />
        <button className="ic-icobtn" type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
          <Icon name="minus" />
        </button>
        <button className="ic-icobtn" type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
          <Icon name="plus" />
        </button>
        <button className="ic-icobtn" type="button" aria-label="Rotate current page clockwise" title="Rotate current page clockwise" disabled={!doc} onClick={() => setSizes((current) => current.map((s, i) => {
          if (i !== page - 1) return s;
          const viewport = s.viewport.clone({ rotation: (s.viewport.rotation + 90) % 360 });
          return { w: viewport.width, h: viewport.height, viewport };
        }))}>↻</button>
        <a className="ic-icobtn" href={url} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab">
          <Icon name="external" />
        </a>
      </div>
      <div className="ic-doc-scroll" ref={scroller} onScroll={onScroll}>
        {error ? <p className="muted" style={{ textAlign: "center" }}>{error}</p> : null}
        {!doc && !error ? <p className="muted" style={{ textAlign: "center" }}>Loading…</p> : null}
        {doc
          ? sizes.map((s, i) => {
              const scale = scaleFor(s.w);
              return (
                <div key={i} className="ic-pdfpage" data-page={i + 1} style={{ width: s.w * scale, height: s.h * scale }}>
                  <canvas
                    ref={(c) => {
                      canvases.current[i] = c;
                    }}
                    style={{ width: s.w * scale, height: s.h * scale }}
                    aria-label={`Page ${i + 1} of ${fileName}`}
                    role="img"
                  />
                  {placed.boxes
                    .filter((b) => b.page === i + 1)
                    .map((b) => (
                      <div
                        key={b.n}
                        className={`ic-hl${focus?.n === b.n ? " ic-hl--focus" : ""}`}
                        style={{ left: screenBox(s, b).left * scale, top: screenBox(s, b).top * scale, width: screenBox(s, b).width * scale, height: screenBox(s, b).height * scale }}
                      >
                        <span className="ic-hl-tag">
                          <span className="ic-pill ic-pill--warn">Line {b.n}</span>
                        </span>
                      </div>
                    ))}
                </div>
              );
            })
          : null}
      </div>
    </section>
  );
}
