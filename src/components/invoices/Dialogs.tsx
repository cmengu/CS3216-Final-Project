"use client";

import { useState } from "react";
import { REASON_MAX } from "@/checker/review";
import { joinPayReasons, mailto, payAnywayLine, payItems, raiseEmail } from "@/checker/present";
import type { SupplierInvoice } from "@/checker/types";
import { Icon } from "@/components/icons";
import { Dialog } from "@/components/ui";

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
  const items = payItems(inv);
  // The reason ticked for each item; OTHER means the clerk's own words in `other`.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setPicked({});
    setOther({});
    setConfirming(false);
    setError(null);
    onClose();
  };
  const chosen = Object.fromEntries(items.map((item) => [item.key, picked[item.key] === OTHER ? (other[item.key] ?? "") : (picked[item.key] ?? "")]));
  const missing = items.filter((item) => !chosen[item.key].trim()).length;
  const reason = joinPayReasons(items, chosen, REASON_MAX);
  const name = inv.number ?? inv.fileName;
  const pick = (key: string, value: string) => setPicked((old) => ({ ...old, [key]: value }));
  return (
    <Dialog
      open={open}
      title={confirming ? "Are you sure?" : "Pay anyway"}
      size="sm"
      onClose={close}
      footer={
        confirming ? (
          <>
            <button type="button" className="ic-btn ic-btn--secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Go back
            </button>
            <button
              type="button"
              className="ic-btn ic-btn--primary"
              disabled={busy}
              data-autofocus
              onClick={async () => {
                setBusy(true);
                const err = await onSubmit(reason);
                setBusy(false);
                if (err) setError(err);
                else close();
              }}
            >
              {busy ? "Saving…" : "Yes, pay anyway"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ic-btn ic-btn--secondary" onClick={close}>
              Cancel
            </button>
            <button type="button" className="ic-btn ic-btn--primary" disabled={missing > 0} onClick={() => setConfirming(true)}>
              Pay anyway
            </button>
          </>
        )
      }
    >
      {confirming ? (
        <>
          <p style={{ margin: 0 }}>
            <b>{name}</b> will be marked ready to pay, even though it doesn&rsquo;t fully match the master list.
          </p>
          <div className="ic-field">
            <span className="lbl">Reason saved with it</span>
            <p className="ic-pay-summary">{reason}</p>
          </div>
          {error ? (
            <p className="ic-hint ic-hint--error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>{payAnywayLine(inv)} Tick why it&rsquo;s OK to pay{items.length > 1 ? " each line" : ""}.</p>
          {items.map((item, i) => (
            <fieldset className="ic-pay-item" key={item.key}>
              <legend>{item.title}</legend>
              {item.why ? <span className={`ic-attn${item.tone === "bad" || item.tone === "info" ? ` ic-attn--${item.tone}` : ""}`}>{item.why}</span> : null}
              <div className="ic-pay-choices">
                {[...item.choices, OTHER].map((choice) => (
                  <label key={choice} className="ic-pay-choice">
                    <input type="radio" name={`pay-${item.key}`} checked={picked[item.key] === choice} onChange={() => pick(item.key, choice)} {...(i === 0 && choice === item.choices[0] ? { "data-autofocus": true } : {})} />
                    {choice}
                  </label>
                ))}
              </div>
              {picked[item.key] === OTHER ? (
                <input
                  className="ic-input"
                  aria-label={`Your reason for ${item.title}`}
                  maxLength={120}
                  placeholder="Price increase agreed by phone"
                  value={other[item.key] ?? ""}
                  onChange={(e) => setOther((old) => ({ ...old, [item.key]: e.target.value }))}
                  autoFocus
                />
              ) : null}
              {i === 0 && items.length > 1 && picked[item.key] && picked[item.key] !== OTHER ? (
                <button
                  type="button"
                  className="ic-link ic-link--sm"
                  style={{ minHeight: 32 }}
                  onClick={() => setPicked(Object.fromEntries(items.map((x) => [x.key, x.choices.includes(picked[item.key]) ? picked[item.key] : (picked[x.key] ?? "")])))}
                >
                  Use this reason for every line it fits
                </button>
              ) : null}
            </fieldset>
          ))}
          {missing ? <span className="ic-hint">{missing === items.length ? "Tick a reason to continue." : `${missing} more to tick.`}</span> : null}
        </>
      )}
    </Dialog>
  );
}

const OTHER = "Other reason";

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
