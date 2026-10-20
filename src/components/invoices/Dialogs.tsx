"use client";

import Link from "next/link";
import { useState } from "react";
import { REASON_MAX } from "@/checker/review";
import { mailto, payAnywayLine, raiseEmail, shortDescription, signed, unit, whenLabel } from "@/checker/present";
import type { SupplierInvoice } from "@/checker/types";
import { Icon } from "@/components/icons";
import { Dialog, Pill } from "@/components/ui";
import type { MasterList } from "@/masterList";

export function PayAnywayDialog({
  inv,
  open,
  onClose,
  onSubmit,
}: {
  inv: SupplierInvoice;
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };
  const ok = reason.trim().length > 0;
  return (
    <Dialog
      open={open}
      title="Pay anyway"
      size="sm"
      onClose={close}
      footer={
        <>
          <button type="button" className="ic-btn ic-btn--secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--primary"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              const err = await onSubmit(reason.trim());
              setBusy(false);
              if (err) setError(err);
              else close();
            }}
          >
            Ready to pay anyway
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{payAnywayLine(inv)}</p>
      <div className="ic-field">
        <label htmlFor="reason">Reason</label>
        <textarea
          id="reason"
          data-autofocus
          className="ic-textarea"
          maxLength={REASON_MAX}
          placeholder="e.g. Price increase agreed by phone"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="reason-count"
        />
        <span id="reason-count" className="ic-hint" style={{ alignSelf: "flex-end" }}>
          {reason.length} / {REASON_MAX}
        </span>
        {!ok ? <span className="ic-hint">Enter a reason to continue.</span> : null}
        {error ? (
          <p className="ic-hint ic-hint--error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function RaiseDialog({
  inv,
  open,
  onClose,
  onRecord,
}: {
  inv: SupplierInvoice;
  open: boolean;
  onClose: () => void;
  onRecord: () => Promise<string | null>;
}) {
  const draft = raiseEmail(inv);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const close = () => {
    setError(null);
    setCopied(false);
    onClose();
  };
  const record = async () => {
    const err = await onRecord();
    if (err) setError(err);
    else close();
  };
  return (
    <Dialog
      open={open}
      title={`Raise with ${inv.supplier ?? "the supplier"}`}
      onClose={close}
      footer={
        <>
          <button type="button" className="ic-btn ic-btn--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                setCopied(true);
              } catch {
                /* clipboard blocked: the text stays in the box to copy by hand */
              }
              await record();
            }}
          >
            <Icon name="copy" size="ui" />
            Copy message
          </button>
          <a className="ic-btn ic-btn--primary" href={mailto(to, { subject, body })} onClick={() => void record()}>
            <Icon name="envelope" size="ui" />
            Open in email
          </a>
        </>
      }
    >
      <div className="ic-field">
        <label htmlFor="to">To</label>
        <input id="to" data-autofocus className="ic-input" type="email" placeholder="Supplier’s email" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="ic-field">
        <label htmlFor="subject">Subject</label>
        <input id="subject" className="ic-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="ic-field">
        <label htmlFor="message">Message</label>
        <textarea id="message" className="ic-textarea" style={{ minHeight: 260 }} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {copied ? (
        <p className="ic-hint" role="status">
          Message copied.
        </p>
      ) : null}
      {error ? (
        <p className="ic-hint ic-hint--error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

export function CompareDrawer({ inv, open, onClose, masterList }: { inv: SupplierInvoice; open: boolean; onClose: () => void; masterList: MasterList | null }) {
  return (
    <Dialog
      open={open}
      drawer
      title="Compare with master list"
      sub={[inv.supplier, inv.purchaseOrder].filter(Boolean).join(" · ")}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{masterList ? `${masterList.file} · ${whenLabel(masterList.uploadedAt)}` : "No master list"}</span>
          <Link className="ic-link" href="/master-list">
            Open master list
            <Icon name="arrowR" arrow />
          </Link>
        </>
      }
    >
      <table className="ic-grid">
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th className="r">Master list</th>
            <th className="r">Invoice</th>
            <th className="r">Difference</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => {
            const differs = l.result === "price_mismatch";
            return (
              <tr key={i}>
                <td>
                  <div>{shortDescription(l)}</div>
                  {l.part ? (
                    <div className="muted mono" style={{ fontSize: 12.5 }}>
                      {l.part}
                    </div>
                  ) : null}
                </td>
                <td>{l.unit ?? ""}</td>
                <td className="r">{l.sheetPrice === null ? "—" : unit(l.sheetPrice)}</td>
                <td className="r" style={differs ? { fontWeight: 600 } : undefined}>
                  {l.unitPrice === null ? "—" : unit(l.unitPrice)}
                </td>
                <td className="r">
                  {l.result === "match" ? (
                    <Pill pill={{ text: "Matches", tone: "good" }} />
                  ) : differs && l.difference !== null ? (
                    <span style={{ color: "var(--warn)", fontWeight: 600 }}>{signed(l.difference)}</span>
                  ) : (
                    <Pill pill={{ text: l.result === "unknown_part" ? "Not on master list" : "Needs you", tone: "warn" }} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Dialog>
  );
}
