"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { orderedLines } from "@/checker/present";
import type { SupplierInvoice } from "@/checker/types";
import { Icon } from "./icons";
import { PriceComparison } from "./invoices/PriceComparison";
import styles from "./InvoicePreview.module.css";

export const PREVIEW_ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

export function PreviewZoom({ zoom, percent, onChange }: { zoom: number; percent: number; onChange: (zoom: number) => void }) {
  return (
    <>
      <button className="ic-icobtn" type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => onChange(Math.max(0, zoom - 1))}><Icon name="minus" /></button>
      <span className="num ic-pdfmodal-zoom" aria-label="Zoom level">{percent}%</span>
      <button className="ic-icobtn" type="button" aria-label="Zoom in" disabled={zoom === PREVIEW_ZOOMS.length - 1} onClick={() => onChange(Math.min(PREVIEW_ZOOMS.length - 1, zoom + 1))}><Icon name="plus" /></button>
    </>
  );
}

/** The same review frame and invoice-line navigation for every original document format. */
export function InvoicePreview({ inv, url, fileName, activeLine, onSelectLine, onClose, tools, children }: {
  inv: SupplierInvoice;
  url: string;
  fileName: string;
  activeLine: number | null;
  onSelectLine?: (line: number) => void;
  onClose?: () => void;
  tools: ReactNode;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    frame.current?.querySelector<HTMLElement>('button[aria-current="true"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".ic-dialog, .ic-drawer")) {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(frame.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]') ?? []).filter((item) => item.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  const download = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Download failed");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch { setDownloadError(true); }
    finally { setDownloading(false); }
  };

  return (
    <div className={`ic-pdfmodal-scrim ${styles.scrim}`} onClick={onClose}>
      <section ref={frame} className={`ic-pdfmodal ${styles.frame}`} role="dialog" aria-modal="true" aria-label="Original invoice" onClick={(event) => event.stopPropagation()}>
        <header className={`ic-pdfmodal-head ${styles.header}`}>
          <div className={`ic-pdfmodal-title ${styles.title}`}><strong>Original invoice</strong><span title={fileName}>{fileName}</span></div>
          <div className={`ic-pdfmodal-tools ${styles.tools}`}>
            {tools}
            <span className="sep" aria-hidden="true" />
            <button type="button" className="ic-icobtn" onClick={() => void download()} disabled={downloading} aria-label={downloading ? "Downloading original invoice" : "Download original invoice"} title="Download original invoice"><Icon name="dl" /></button>
            {onClose ? <button className="ic-pdfmodal-close" type="button" onClick={onClose} aria-label="Close invoice preview"><Icon name="x" /><span>Close</span><kbd>Esc</kbd></button> : null}
          </div>
        </header>
        {downloadError ? <p className={styles.error} role="alert">The original invoice couldn’t be downloaded. Try again.</p> : null}
        <div className="ic-pdfmodal-body">
          <aside className="ic-pdfmodal-side" aria-label="Invoice lines">
            <div className="ic-pdfmodal-lines" role="list">
              {orderedLines(inv).map(({ line, n }) => (
                <div key={n} role="listitem" className="ic-pdfmodal-item" aria-current={activeLine === n ? "true" : undefined}>
                  <button type="button" className="ic-pdfmodal-line" aria-current={activeLine === n ? "true" : undefined} onClick={() => onSelectLine?.(n)}>
                    <span className="ico">{line.result === "match" ? <Icon name="tick" style={{ color: "var(--good)", strokeWidth: 2 }} /> : <Icon name="warn" style={{ color: "var(--warn)" }} />}</span>
                    <span className="lbl"><span>{n} · {line.description.trim() || line.part || "No description"}</span></span>
                  </button>
                  <PriceComparison line={line} currency={inv.currency} number={n} />
                </div>
              ))}
            </div>
          </aside>
          <div className="ic-pdfmodal-stage">{children}</div>
        </div>
      </section>
    </div>
  );
}
