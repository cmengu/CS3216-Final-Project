"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { useUser } from "@/auth";
import { Icon } from "@/components/icons";
import { useMasterList } from "@/masterList";

// TODO: replace with the real contact address before launch.
const CONTACT_EMAIL = "hello@invoicechecker.com";

/* ---------------------------------------------------------------------------
   The sample invoices are real lines from data/mock_invoice_dataset (synthetic).
   Check times are the 26 Oct 2026 benchmark (docs/review/2026-10-26-model-benchmark.md).
   --------------------------------------------------------------------------- */

type Verdict = "match" | "over" | "person";
type Result = "raise" | "person" | "ready";

type Line = {
  name: string;
  qty: string;
  invoice: string;
  verdict: Verdict;
  /** Over lines: the sheet price, with the share of the invoice price that is over it (for the bar). */
  sheet?: string;
  sheetShare?: number;
  pill?: string;
  note?: string;
};

type Sample = {
  id: "hose" | "service" | "freight";
  tab: string;
  supplier: string;
  file: string;
  currency: string;
  time: string;
  lines: Line[];
  more?: number;
  result: Result;
  summary: string;
};

const SAMPLES: Sample[] = [
  {
    id: "hose",
    tab: "Hose",
    supplier: "DEF Hose Company",
    file: "F02_hose_tax_02.pdf",
    currency: "SGD",
    time: "5.4 s",
    result: "raise",
    summary: "Over by SGD 159.60",
    lines: [
      {
        name: "1 inch SS hose, 237 mm",
        qty: "28 LG",
        invoice: "74.25",
        verdict: "over",
        sheet: "68.25",
        sheetShare: 91.9,
        pill: "Over by SGD 159.60",
        note: "5% discount applied",
      },
      { name: "1 inch SS hose, 195 mm", qty: "18 LG", invoice: "72.40", verdict: "match" },
    ],
  },
  {
    id: "service",
    tab: "Service",
    supplier: "JKL Machine Services",
    file: "F04_service_tax_01.pdf",
    currency: "SGD",
    time: "6.2 s",
    result: "person",
    summary: "1 line needs you",
    lines: [
      {
        name: "Engineer, first hour",
        qty: "1 HR",
        invoice: "142.50",
        verdict: "person",
        pill: "Needs you",
        note: "A14L-0156-0001#24R",
      },
      { name: "Power supply", qty: "1 PCE", invoice: "312.60", verdict: "match" },
      { name: "Engineer, extra hours", qty: "2 HR", invoice: "87.25", verdict: "match" },
    ],
  },
  {
    id: "freight",
    tab: "Freight",
    supplier: "ABC Logistics",
    file: "F01_freight_tax_01.pdf",
    currency: "SGD",
    time: "8.4 s",
    result: "ready",
    summary: "All lines match",
    more: 4,
    lines: [
      { name: "Freight", qty: "2.4 M3", invoice: "111.35", verdict: "match" },
      { name: "Emergency bunker surcharge", qty: "2.4 M3", invoice: "18.34", verdict: "match" },
      { name: "General rate increase", qty: "2.4 M3", invoice: "23.58", verdict: "match" },
    ],
  },
];

type TileKind = "ok" | "caught" | "person";
type Tile = { id: string; layout: string; kind: TileKind; seconds: number; text: string };

/** The 14 mock invoices of the benchmark, in file order (_01 clean, _02 with one planted price error). */
const TILES: Tile[] = [
  { id: "F01_01", layout: "Freight", kind: "ok", seconds: 8.42, text: "All 7 lines match" },
  { id: "F01_02", layout: "Freight", kind: "caught", seconds: 5.41, text: "Over by SGD 20.96" },
  { id: "F02_01", layout: "Hose", kind: "ok", seconds: 5.3, text: "Both lines match" },
  { id: "F02_02", layout: "Hose", kind: "caught", seconds: 5.43, text: "Over by SGD 159.60" },
  { id: "F03_01", layout: "Tools", kind: "ok", seconds: 4.97, text: "Both lines match" },
  { id: "F03_02", layout: "Tools", kind: "caught", seconds: 3.71, text: "Over by SGD 25.00" },
  { id: "F04_01", layout: "Service", kind: "person", seconds: 6.17, text: "1 line sent to a person, not guessed" },
  { id: "F04_02", layout: "Service", kind: "caught", seconds: 5.53, text: "Under by SGD 21.00" },
  { id: "F05_01", layout: "Proforma", kind: "ok", seconds: 3.96, text: "Both lines match" },
  { id: "F05_02", layout: "Proforma", kind: "caught", seconds: 3.53, text: "Over by USD 36.00" },
  { id: "F06_01", layout: "Steel", kind: "ok", seconds: 18.99, text: "All 11 lines match" },
  { id: "F06_02", layout: "Steel", kind: "caught", seconds: 8.13, text: "Over by USD 72.00" },
  { id: "F07_01", layout: "Hardware", kind: "ok", seconds: 3.94, text: "Both lines match" },
  { id: "F07_02", layout: "Hardware", kind: "caught", seconds: 4.61, text: "Under by SGD 20.00" },
];
const MAX_SECONDS = 19;
const MEAN_SECONDS = 6.3;
const LAYOUTS = ["Freight", "Hose", "Tools", "Service", "Proforma", "Steel", "Hardware"];

const STAGE_LABELS = ["Drop in", "Check", "Decide"] as const;

const css = (vars: Record<string, string | number>) => vars as CSSProperties;

/** True once the element has been on screen. */
function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return seen;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function LandingPage() {
  const user = useUser();
  const ml = useMasterList();
  const signedIn = Boolean(user);
  const workspaceHref = signedIn ? (ml === null ? "/master-list" : "/invoices") : "/sign-in";
  const ctaLabel = signedIn ? "Open workspace" : "Sign in to workspace";

  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [sampleId, setSampleId] = useState<Sample["id"]>("hose");
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const steps = useRef<(HTMLElement | null)[]>([]);

  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];

  // The stage follows the step that sits on the reading line as the page scrolls.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const narrow = window.matchMedia("(max-width: 960px)").matches;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStage(Number(e.target.getAttribute("data-step")) as 0 | 1 | 2);
        }
      },
      { rootMargin: narrow ? "-74% 0px -20% 0px" : "-42% 0px -42% 0px" },
    );
    steps.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const goTo = (i: 0 | 1 | 2) => {
    setStage(i);
    steps.current[i]?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  };

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link className="ic-brand" href="/">
          <span className="ic-mark" aria-hidden="true">
            <Icon name="tick" size="ui" />
          </span>
          Invoice Checker
        </Link>
        <Link className="ic-btn ic-btn--primary" href={workspaceHref}>
          {signedIn ? "Open workspace" : "Sign in"}
          <Icon name="arrowR" arrow />
        </Link>
      </header>

      <main>
        <div className="lp-story">
          <section className="lp-step lp-step--0" ref={(el) => { steps.current[0] = el; }} data-step="0" aria-labelledby="lp-h1">
            <h1 id="lp-h1" className="lp-h1">
              Know before you pay.
            </h1>
            <p className="lp-lead">Every invoice line, checked against your agreed prices.</p>
            <div className="lp-cta">
              <Link className="ic-btn ic-btn--primary lp-cta-btn" href={workspaceHref}>
                {ctaLabel}
                <Icon name="arrowR" arrow />
              </Link>
              <button type="button" className="lp-see" onClick={() => goTo(1)}>
                Watch it check
                <Icon name="chevDown" />
              </button>
            </div>
          </section>

          <div className="lp-stage" data-stage={stage}>
            <InvoiceCard
              stage={stage}
              sample={sample}
              onSample={setSampleId}
              onStage={goTo}
              decided={Boolean(decided[sample.id])}
              onDecide={(v) => setDecided((d) => ({ ...d, [sample.id]: v }))}
            />
          </div>

          <section className="lp-step" ref={(el) => { steps.current[1] = el; }} data-step="1" aria-labelledby="lp-h2a">
            <h2 id="lp-h2a" className="lp-h2">
              Every line. Checked.
            </h2>
            <p className="lp-lead">Over the sheet price? Amber. Not sure? It asks you.</p>
          </section>

          <section className="lp-step" ref={(el) => { steps.current[2] = el; }} data-step="2" aria-labelledby="lp-h2b">
            <h2 id="lp-h2b" className="lp-h2">
              Decide in one click.
            </h2>
            <p className="lp-lead">Ready to pay only appears when every line matches.</p>
          </section>
        </div>

        <Proof />

        <Close workspaceHref={workspaceHref} ctaLabel={ctaLabel} />
      </main>

      <footer className="lp-footer">
        <span>Invoice Checker</span>
        <span>All invoices, names and prices on this page are synthetic.</span>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function InvoiceCard({
  stage,
  sample,
  onSample,
  onStage,
  decided,
  onDecide,
}: {
  stage: 0 | 1 | 2;
  sample: Sample;
  onSample: (id: Sample["id"]) => void;
  onStage: (i: 0 | 1 | 2) => void;
  decided: boolean;
  onDecide: (v: boolean) => void;
}) {
  const checked = stage > 0;
  const n = sample.lines.length;
  const summaryTone = sample.result === "ready" ? "good" : "warn";

  return (
    <div className="lp-card" data-checked={checked} data-result={sample.result}>
      <div className="lp-progress" role="group" aria-label="Steps">
        {STAGE_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="lp-prog"
            aria-pressed={stage === i}
            data-done={stage > i}
            onClick={() => onStage(i as 0 | 1 | 2)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="lp-card-head">
        <div className="lp-seg" role="group" aria-label="Sample invoice">
          {SAMPLES.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === sample.id} onClick={() => onSample(s.id)}>
              {s.tab}
            </button>
          ))}
        </div>
        <span className="lp-file">
          <Icon name={stage === 0 ? "mail" : "doc"} />
          <span key={stage === 0 ? "in" : "file"} className="lp-file-name">
            {stage === 0 ? "New from Outlook" : sample.file}
          </span>
        </span>
      </div>

      <div className="lp-sheet">
        <div className="lp-sheet-head">
          <b>{sample.supplier}</b>
          <span>
            {sample.currency} · {n + (sample.more ?? 0)} lines
          </span>
        </div>

        <div className="lp-lines" key={`${sample.id}-${checked ? "c" : "d"}`} style={css({ "--n": n })}>
          {checked ? <span className="lp-beam" aria-hidden="true" /> : null}
          {sample.lines.map((l, i) => (
            <div key={l.name} className="lp-row" data-v={checked ? l.verdict : "idle"} style={css({ "--i": i })}>
              <span className="lp-mark" aria-hidden="true">
                {checked ? <Icon name={l.verdict === "match" ? "check" : l.verdict === "over" ? "warn" : "people"} /> : null}
              </span>
              <span className="lp-name">
                {l.name}
                <small>{l.qty}</small>
              </span>
              <span className="lp-price">{l.invoice}</span>
              <span className="lp-verdict">
                {checked ? (
                  <span className={`ic-pill${l.verdict === "match" ? " ic-pill--good" : " ic-pill--warn"}`}>
                    {l.pill ?? "Matches"}
                  </span>
                ) : (
                  <span className="lp-wait" aria-hidden="true" />
                )}
              </span>
              {checked && l.verdict === "over" ? <OverBars line={l} /> : null}
              {checked && l.verdict === "person" ? <Smudge line={l} /> : null}
            </div>
          ))}
          {sample.more ? (
            <div className="lp-more" data-v={checked ? "match" : "idle"} style={css({ "--i": n })}>
              <span className="lp-mark" aria-hidden="true">
                {checked ? <Icon name="check" /> : null}
              </span>
              <span>{sample.more} more lines</span>
              {checked ? <span className="ic-pill ic-pill--good">Match</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="lp-foot" aria-live="polite">
        {stage === 0 ? (
          <span className="lp-hint">Waiting to be checked</span>
        ) : (
          <span className="lp-sum">
            <span className={`ic-pill ic-pill--${summaryTone}`}>{sample.summary}</span>
            <small>Checked in {sample.time}</small>
          </span>
        )}
        {stage === 2 ? <Decide sample={sample} decided={decided} onDecide={onDecide} /> : null}
      </div>
    </div>
  );
}

/** Invoice price against sheet price, drawn from zero. The part over the sheet is amber. */
function OverBars({ line }: { line: Line }) {
  const share = line.sheetShare ?? 100;
  return (
    <div className="lp-cmp">
      <span className="lp-cmp-k">Invoice</span>
      <span className="lp-cmp-bar">
        <i style={{ width: `${share}%` }} />
        <i className="over" style={{ width: `${100 - share}%` }} />
      </span>
      <b>{line.invoice}</b>
      <span className="lp-cmp-k">Sheet</span>
      <span className="lp-cmp-bar">
        <i style={{ width: `${share}%` }} />
      </span>
      <b>{line.sheet}</b>
      {line.note ? <small className="lp-cmp-note">{line.note}</small> : null}
    </div>
  );
}

/** A part code the scan could not make out: shown smudged, left to a person. */
function Smudge({ line }: { line: Line }) {
  return (
    <div className="lp-smudge">
      <code>{line.note}</code>
      <span>Part code unclear on the scan. Nothing guessed.</span>
    </div>
  );
}

function Decide({ sample, decided, onDecide }: { sample: Sample; decided: boolean; onDecide: (v: boolean) => void }) {
  if (decided) {
    const ready = sample.result === "ready";
    return (
      <span className="lp-done">
        <span className={`ic-pill ${ready ? "ic-pill--good" : "ic-pill--warn"}`}>
          {ready ? "Ready to pay" : "Raise with supplier"}
        </span>
        <small>{ready ? "Added to the CSV" : "Dispute note ready"}</small>
        <button type="button" className="ic-link ic-link--sm" onClick={() => onDecide(false)}>
          <Icon name="undo" />
          Undo
        </button>
      </span>
    );
  }
  if (sample.result === "ready") {
    return (
      <button type="button" className="ic-btn ic-btn--primary" onClick={() => onDecide(true)}>
        Ready to pay
        <Icon name="check" />
      </button>
    );
  }
  return (
    <span className="lp-actions">
      {sample.result === "raise" ? (
        <button type="button" className="ic-btn ic-btn--primary" onClick={() => onDecide(true)}>
          Raise with supplier
        </button>
      ) : null}
      <button type="button" className="ic-btn ic-btn--secondary" disabled>
        Ready to pay
      </button>
    </span>
  );
}

/* ----------------------------------------------------------------------- */

function Proof() {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useSeen(ref);
  const [pick, setPick] = useState<Tile | null>(null);

  return (
    <section className="lp-proof" aria-labelledby="lp-proof-h">
      <div className="lp-proof-in" ref={ref}>
        <h2 id="lp-proof-h" className="lp-h2">
          Seven price errors. Seven caught.
        </h2>

        <div className="lp-proof-grid">
          <div>
            <div className={`lp-tiles${seen ? " in" : ""}`} role="group" aria-label="The 14 mock invoices">
              {TILES.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  className="lp-tile"
                  data-kind={t.kind}
                  data-on={pick?.id === t.id}
                  style={css({ "--d": `${Math.floor(i / 2) * 110 + (i % 2) * 70}ms` })}
                  onMouseEnter={() => setPick(t)}
                  onFocus={() => setPick(t)}
                  onClick={() => setPick(t)}
                  aria-label={`${t.layout} invoice ${t.id.endsWith("01") ? "one" : "two"}: ${t.text}`}
                >
                  <span className="lp-tile-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="lp-tile-badge" aria-hidden="true">
                    <Icon name={t.kind === "ok" ? "check" : t.kind === "caught" ? "warn" : "people"} />
                  </span>
                </button>
              ))}
            </div>
            <div className="lp-tile-names" aria-hidden="true">
              {LAYOUTS.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
            <ul className="lp-legend">
              <li data-kind="ok">All lines match</li>
              <li data-kind="caught">Price error caught</li>
              <li data-kind="person">Left to a person</li>
            </ul>
            <p className="lp-caption" aria-live="polite">
              {pick ? (
                <>
                  <b>
                    {pick.layout} {pick.id.endsWith("01") ? "1" : "2"}
                  </b>{" "}
                  {pick.text}. Checked in {pick.seconds.toFixed(1)} s.
                </>
              ) : (
                <>
                  <b>7 of 7</b> price errors caught. <b>0</b> false alarms. Tap an invoice.
                </>
              )}
            </p>
          </div>

          <div>
            <div className={`lp-bars${seen ? " in" : ""}`} role="img" aria-label="Seconds to check each of the 14 invoices. Most take under 9 seconds.">
              {TILES.map((t, i) => (
                <span
                  key={t.id}
                  className="lp-bar"
                  data-on={pick?.id === t.id}
                  style={css({ "--h": `${(t.seconds / MAX_SECONDS) * 100}%`, "--i": i })}
                />
              ))}
              <span className="lp-avg" style={css({ "--avg": `${(MEAN_SECONDS / MAX_SECONDS) * 100}%` })}>
                <small>Average {MEAN_SECONDS} s</small>
              </span>
            </div>
            <p className="lp-caption lp-caption--bars">Seconds to check each invoice.</p>
          </div>
        </div>

        <p className="lp-fine">
          Measured 26 Oct 2026 on 14 synthetic mock invoices, 58 lines. Check time excludes reading the scan.
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- */

function Close({ workspaceHref, ctaLabel }: { workspaceHref: string; ctaLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [opened, setOpened] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked: the address is on screen to copy by hand. */
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`[Invoice Checker] ${name}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setOpened(true);
  };

  return (
    <section className="lp-close" aria-labelledby="lp-close-h">
      <div>
        <h2 id="lp-close-h" className="lp-h2">
          Check your next invoice.
        </h2>
        <Link className="ic-btn ic-btn--primary lp-cta-btn" href={workspaceHref}>
          {ctaLabel}
          <Icon name="arrowR" arrow />
        </Link>
      </div>

      <div className="lp-contact" id="contact">
        <h3>Questions? Write to us.</h3>
        <div className="lp-email">
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <button type="button" className="ic-btn ic-btn--secondary ic-btn--sm" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <form onSubmit={send} className="lp-form">
          <div className="lp-form-row">
            <div className="ic-field">
              <label htmlFor="lp-name">Name</label>
              <input id="lp-name" className="ic-input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="ic-field">
              <label htmlFor="lp-email">Work email</label>
              <input id="lp-email" className="ic-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="ic-field">
            <label htmlFor="lp-msg">Message</label>
            <textarea id="lp-msg" className="ic-input lp-textarea" rows={3} required value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="lp-form-end">
            {opened ? <span role="status">Your email app should open with the message ready.</span> : <span />}
            <button type="submit" className="ic-btn ic-btn--primary">
              <Icon name="envelope" />
              Send
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
