"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupplierInvoice } from "@/checker/types";
import { InvoicePreview, PreviewZoom, PREVIEW_ZOOMS } from "./InvoicePreview";
import { parseXmlInvoice, xmlNumber, xmlRate, type XmlParty } from "./xmlInvoice";
import styles from "./XmlView.module.css";

function Party({ title, party }: { title: string; party: XmlParty }) {
  return (
    <section className={styles.party} aria-label={title}>
      <h3>{title}</h3>
      <p className={styles.partyName}>{party.name ?? "Not provided"}</p>
      {party.address ? <p>{party.address}</p> : null}
      <dl>
        {party.taxId ? <div><dt>Tax ID</dt><dd>{party.taxId}</dd></div> : null}
        {party.phone ? <div><dt>Phone</dt><dd>{party.phone}</dd></div> : null}
        {party.email ? <div><dt>Email</dt><dd>{party.email}</dd></div> : null}
      </dl>
    </section>
  );
}

const KIND: Record<string, string> = { "2": "Promotion", "3": "Discount", "4": "Note" };

export function XmlView({ inv, url, fileName, focus, onSelectLine, onClose }: { inv: SupplierInvoice; url: string; fileName: string; focus: { n: number; seq: number } | null; onSelectLine: (n: number) => void; onClose: () => void }) {
  const line = focus?.n ?? null;
  const [zoom, setZoom] = useState(3);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Source unavailable");
        const text = await response.text();
        if (!controller.signal.aborted) setSource(text);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [url]);
  const invoice = useMemo(() => {
    if (source === null) return null;
    try { return parseXmlInvoice(source); } catch { return null; }
  }, [source]);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [invoice, focus, zoom]);
  const discounts = invoice?.lines.some((row) => row.discountRate !== null || row.discountAmount !== null);
  const selected = line !== null && invoice && line > 0 && line <= invoice.lines.length;
  return (
    <InvoicePreview inv={inv} url={url} fileName={fileName} activeLine={line} onSelectLine={onSelectLine} onClose={onClose} tools={<PreviewZoom zoom={zoom} percent={Math.round(PREVIEW_ZOOMS[zoom] * 100)} onChange={setZoom} />}>
      <div className={`ic-doc-scroll ${styles.scroll}`}>
        <div className={styles.paper} style={{ zoom: PREVIEW_ZOOMS[zoom] }}>
      {error ? <p role="alert">The original invoice couldn’t be loaded. Close this preview and try again.</p> : source === null ? <p role="status">Loading invoice…</p> : (
        <>
          {invoice ? (
            <article className={styles.invoice} aria-label="Readable invoice">
              <header className={styles.header}>
                <div>
                  <h3>Invoice {invoice.number ?? "number not provided"}</h3>
                  {invoice.title ? <p className={styles.documentTitle}>{invoice.title}</p> : null}
                </div>
                <dl className={styles.metadata}>
                  <div><dt>Issue date</dt><dd>{invoice.date ?? "Not provided"}</dd></div>
                  {invoice.series ? <div><dt>Series</dt><dd>{invoice.series}</dd></div> : null}
                  <div><dt>Currency</dt><dd>{invoice.currency ?? "Not provided"}</dd></div>
                </dl>
              </header>
              <div className={styles.parties}><Party title="Supplier" party={invoice.seller} /><Party title="Bill to" party={invoice.buyer} /></div>
              <section aria-label="Original invoice items">
                <div className={styles.itemsHeading}><h3>Invoice items</h3>{selected ? <span className={styles.selectedLabel}>Line {line} selected</span> : null}</div>
                {invoice.lines.length ? (
                  <table className={styles.lines}>
                    <caption className="sr">Original invoice items{invoice.currency ? `, amounts in ${invoice.currency}` : ""}</caption>
                    <thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Unit price</th>{discounts ? <th scope="col">Discount</th> : null}<th scope="col">Tax rate</th><th scope="col">Amount</th></tr></thead>
                    <tbody>{invoice.lines.map((row, index) => {
                      const number = index + 1;
                      return (
                        <tr key={number} ref={number === line ? selectedRow : undefined} aria-current={number === line ? "true" : undefined} className={number === line ? styles.selected : undefined}>
                          <th scope="row" className={styles.item}><span className={styles.lineNumber}>{number}.</span><span>{row.description ?? row.code ?? "Description not provided"}{row.code && row.description ? <span className={styles.itemCode}>{row.code}</span> : null}{row.kind && KIND[row.kind] ? <span className={styles.itemCode}>{KIND[row.kind]}</span> : null}</span></th>
                          <td><span className={styles.mobileLabel} aria-hidden="true">Quantity</span>{xmlNumber(row.quantity)}{row.unit ? <span className={styles.unit}> {row.unit}</span> : null}</td>
                          <td><span className={styles.mobileLabel} aria-hidden="true">Unit price</span>{xmlNumber(row.unitPrice)}</td>
                          {discounts ? <td><span className={styles.mobileLabel} aria-hidden="true">Discount</span>{row.discountAmount !== null ? xmlNumber(row.discountAmount) : row.discountRate !== null ? xmlRate(row.discountRate) : "Not provided"}</td> : null}
                          <td><span className={styles.mobileLabel} aria-hidden="true">Tax rate</span>{xmlRate(row.tax)}</td>
                          <td className={styles.lineAmount}><span className={styles.mobileLabel} aria-hidden="true">Amount</span>{xmlNumber(row.amount)}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                ) : <p className="muted">No invoice items were provided.</p>}
              </section>
              <div className={styles.summary}>
                {invoice.payment ? <p className={styles.payment}><span>Payment method</span>{invoice.payment}</p> : <span />}
                <dl className={styles.totals} aria-label="Original invoice totals">
                  <div><dt>Subtotal</dt><dd>{xmlNumber(invoice.subtotal)}</dd></div>
                  {invoice.discount !== null ? <div><dt>Discount</dt><dd>{xmlNumber(invoice.discount)}</dd></div> : null}
                  <div><dt>Tax</dt><dd>{xmlNumber(invoice.tax)}</dd></div>
                  <div className={styles.total}><dt>Total</dt><dd>{invoice.currency && invoice.total !== null ? `${invoice.currency} ` : ""}{xmlNumber(invoice.total)}</dd></div>
                </dl>
              </div>
              {invoice.totalWords ? <p className={styles.totalWords}>{invoice.totalWords}</p> : null}
              <p className={styles.provenance}>Values from the original invoice. Missing fields are shown as “Not provided”.</p>
            </article>
          ) : <p role="alert">This invoice couldn’t be formatted. You can view the raw XML below or download the original file.</p>}
          <details className={styles.source}><summary>View raw XML</summary><pre>{source}</pre></details>
        </>
      )}
        </div>
      </div>
    </InvoicePreview>
  );
}
