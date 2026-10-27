"use client";

/*
 * The original PDF, rendered with pdf.js, with the selected line highlighted. A highlight is placed
 * from the reader's blocks (ParsedDocument.blocks[].locations): the block whose text holds the
 * line's part number (else its description) gives the page and horizontal extent. When the PDF's
 * own text layer has that part number, the highlight is narrowed to that row; otherwise it covers
 * the block. When nothing matches, "Show" just scrolls to the line's page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  orderedLines,
} from "@/checker/present";
import type { SourceBlock, SupplierInvoice } from "@/checker/types";
import { PriceComparison } from "./invoices/PriceComparison";
import { blockFor } from "./pdfEvidence";
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
    const row = found.block.kind === "table-row" ? matched : wholeItemRow(blocks.flatMap((block) => block.locations
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
  inv,
  url,
  fileName,
  marks,
  blocks,
  focus,
  rotations,
  onSelectLine,
  onClose,
}: {
  inv?: SupplierInvoice;
  onSelectLine?: (n: number) => void;
  onClose?: () => void;
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
        const loading = pdfjs.getDocument({ url, withCredentials: true });
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

  const margin = inv ? 120 : 40;
  const scaleFor = useCallback((w: number) => (width ? (Math.max(240, width - margin) / w) * ZOOMS[zoom] : 1), [width, zoom, margin]);

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

  const scrollToTarget = useCallback((target: HTMLElement, highlight = false) => {
    const pane = scroller.current;
    if (!pane) return;
    const outer = pane.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    // Rectangles share viewport coordinates; offsetTop may use an ancestor outside the pane.
    const top = pane.scrollTop + rect.top - outer.top - pane.clientTop;
    const left = pane.scrollLeft + rect.left - outer.left - pane.clientLeft;
    const pad = highlight ? Math.min(80, pane.clientHeight / 4) : 20;
    pane.scrollTo({
      top: Math.max(0, top - pad),
      left: Math.max(0, left - (highlight ? Math.max(20, (pane.clientWidth - rect.width) / 2) : 0)),
      behavior: "smooth",
    });
  }, []);

  const goTo = useCallback((p: number) => {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-page="${p}"]`);
    if (target) scrollToTarget(target);
  }, [scrollToTarget]);

  // Wait for the pane and highlights to be laid out before focusing their rendered position.
  useEffect(() => {
    if (!focus || !doc || !width) return;
    const frame = requestAnimationFrame(() => {
      const target = scroller.current?.querySelector<HTMLElement>(`[data-line="${focus.n}"]`);
      if (target) scrollToTarget(target, true);
      else if (placed.pages[focus.n]) goTo(placed.pages[focus.n]);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, doc, width, placed, sizes, zoom, goTo, scrollToTarget]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const pages = [...el.querySelectorAll<HTMLElement>("[data-page]")];
    const mid = el.getBoundingClientRect().top + el.clientTop + el.clientHeight / 3;
    const at = pages.findLast((p) => p.getBoundingClientRect().top <= mid);
    if (at) setPage(Number(at.dataset.page));
  };

  const rotatePage = () => setSizes((current) => current.map((s, i) => {
    if (i !== page - 1) return s;
    const viewport = s.viewport.clone({ rotation: (s.viewport.rotation + 90) % 360 });
    return { w: viewport.width, h: viewport.height, viewport };
  }));

  const n = doc?.numPages ?? 0;
  const zoomPct = Math.round((sizes[page - 1] ? scaleFor(sizes[page - 1].w) : ZOOMS[zoom]) * 100);

  const canvasNodes = (
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
                  .filter((b) => b.page === i + 1 && focus?.n === b.n)
                  .map((b) => (
                    <div
                      key={b.n}
                      data-line={b.n}
                      className={`ic-hl${focus?.n === b.n ? " ic-hl--focus" : ""}`}
                      style={{ left: screenBox(s, b).left * scale, top: screenBox(s, b).top * scale, width: screenBox(s, b).width * scale, height: screenBox(s, b).height * scale }}
                    />
                  ))}
              </div>
            );
          })
        : null}
    </div>
  );

  if (inv) {
    return (
      <div className="ic-pdfmodal-scrim" onClick={onClose}>
        <section
          className="ic-pdfmodal"
          role="dialog"
          aria-modal="true"
          aria-label="Invoice PDF"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="ic-pdfmodal-head">
            <div className="ic-pdfmodal-tools">
              <button className="ic-icobtn" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                <Icon name="chevL" />
              </button>
              <span className="num ic-pdfmodal-page" aria-live="polite">
                {n ? `Page ${page} of ${n}` : "Loading…"}
              </span>
              <button className="ic-icobtn" type="button" aria-label="Next page" disabled={!n || page >= n} onClick={() => goTo(page + 1)}>
                <Icon name="chev" />
              </button>
              <span className="sep" aria-hidden="true" />
              <button className="ic-icobtn" type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
                <Icon name="minus" />
              </button>
              <span className="num ic-pdfmodal-zoom">{zoomPct}%</span>
              <button className="ic-icobtn" type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
                <Icon name="plus" />
              </button>
              <button className="ic-icobtn" type="button" aria-label="Rotate current page clockwise" title="Rotate current page clockwise" disabled={!doc} onClick={rotatePage}>↻</button>
              {onClose ? (
                <button className="ic-pdfmodal-close" type="button" onClick={onClose} aria-label="Close PDF preview">
                  <Icon name="x" />
                  <span>Close</span>
                  <kbd>Esc</kbd>
                </button>
              ) : null}
            </div>
          </header>

          <div className="ic-pdfmodal-body">
            <aside className="ic-pdfmodal-side" aria-label="Invoice lines">
              <div className="ic-pdfmodal-lines" role="list">
                {orderedLines(inv).map(({ line, n: lineNum }) => {
                  const flagged = line.result !== "match";
                  const active = focus?.n === lineNum;
                  return (
                    <div key={lineNum} role="listitem" className="ic-pdfmodal-item" aria-current={active ? "true" : undefined}>
                    <button
                      type="button"
                      className="ic-pdfmodal-line"
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSelectLine?.(lineNum)}
                    >
                      <span className="ico">
                        {flagged ? (
                          <Icon name="warn" style={{ color: "var(--warn)" }} />
                        ) : (
                          <Icon name="tick" style={{ color: "var(--good)", strokeWidth: 2 }} />
                        )}
                      </span>
                      <span className="lbl">
                        <span>
                          {lineNum} · {line.description.trim() || line.part || "No description"}
                        </span>
                      </span>
                    </button>
                    <PriceComparison line={line} currency={inv.currency} number={lineNum} />
                    </div>
                  );
                })}
              </div>
            </aside>
            <div className="ic-pdfmodal-stage">{canvasNodes}</div>
          </div>

        </section>
      </div>
    );
  }

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
        <button className="ic-icobtn" type="button" aria-label="Rotate current page clockwise" title="Rotate current page clockwise" disabled={!doc} onClick={rotatePage}>↻</button>
        <a className="ic-icobtn" href={url} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab">
          <Icon name="external" />
        </a>
        {onClose ? <button className="ic-icobtn" type="button" onClick={onClose} aria-label="Close PDF preview"><Icon name="x" /></button> : null}
      </div>
      {canvasNodes}
    </section>
  );
}
