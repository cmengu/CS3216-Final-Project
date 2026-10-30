"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useUser } from "@/auth";
import { Icon, type IconName } from "@/components/icons";
import { useMasterList } from "@/masterList";


/* ---------------------------------------------------------------------------
   Sample invoices are real lines from data/mock_invoice_dataset (synthetic).
   Check times are from the 26 Oct 2026 benchmark (docs/review/2026-10-26-model-benchmark.md).
   The card has a fixed size: every sample and every stage fills the same boxes, so nothing moves.
   --------------------------------------------------------------------------- */

type Verdict = "match" | "over" | "person";
type Result = "raise" | "person" | "ready";

type Line = {
  name: string;
  qty: string;
  invoice: string;
  verdict: Verdict;
  pill?: string;
  short?: string;
};

type Sample = {
  id: "hose" | "service" | "freight";
  tab: string;
  supplier: string;
  file: string;
  currency: string;
  time: string;
  lines: Line[];
  more?: string;
  totals: { subtotal: string; tax: string; rate: string; total: string };
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
    totals: { subtotal: "3,213.09", tax: "289.18", rate: "9%", total: "3,502.27" },
    lines: [
      { name: "1 inch SS hose, 237 mm", qty: "28 LG", invoice: "74.25", verdict: "over", pill: "Over by SGD 159.60", short: "Over" },
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
    totals: { subtotal: "629.60", tax: "56.66", rate: "9%", total: "686.26" },
    lines: [
      { name: "Engineer, first hour", qty: "1 HR", invoice: "142.50", verdict: "person", pill: "Needs you", short: "Needs you" },
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
    more: "5 more lines",
    totals: { subtotal: "642.75", tax: "0.00", rate: "0%", total: "642.75" },
    lines: [
      { name: "Freight", qty: "2.4 M3", invoice: "111.35", verdict: "match" },
      { name: "Emergency bunker surcharge", qty: "2.4 M3", invoice: "18.34", verdict: "match" },
    ],
  },
];

type Kind = "ok" | "caught" | "person";
type Cell = { kind: Kind; text: string; sec: number };
type BoardRow = { layout: string; clean: Cell; changed: Cell };

/** The 14 mock invoices of the benchmark: each layout once clean and once with one price changed. */
const BOARD: BoardRow[] = [
  { layout: "Freight", clean: { kind: "ok", text: "All 7 lines match", sec: 8.42 }, changed: { kind: "caught", text: "Over by SGD 20.96", sec: 5.41 } },
  { layout: "Hose", clean: { kind: "ok", text: "Both lines match", sec: 5.3 }, changed: { kind: "caught", text: "Over by SGD 159.60", sec: 5.43 } },
  { layout: "Tools", clean: { kind: "ok", text: "Both lines match", sec: 4.97 }, changed: { kind: "caught", text: "Over by SGD 25.00", sec: 3.71 } },
  { layout: "Service", clean: { kind: "person", text: "1 line left to a person", sec: 6.17 }, changed: { kind: "caught", text: "Under by SGD 21.00", sec: 5.53 } },
  { layout: "Proforma", clean: { kind: "ok", text: "Both lines match", sec: 3.96 }, changed: { kind: "caught", text: "Over by USD 36.00", sec: 3.53 } },
  { layout: "Steel", clean: { kind: "ok", text: "All 11 lines match", sec: 18.99 }, changed: { kind: "caught", text: "Over by USD 72.00", sec: 8.13 } },
  { layout: "Hardware", clean: { kind: "ok", text: "Both lines match", sec: 3.94 }, changed: { kind: "caught", text: "Under by SGD 20.00", sec: 4.61 } },
];
const MAX_SECONDS = 19;
const PLANTED = BOARD.length;
const CELL_ICON: Record<Kind, IconName> = { ok: "check", caught: "warn", person: "people" };

const STAGE_LABELS = ["Drop in", "Check", "Decide"] as const;
type Stage = 0 | 1 | 2;

const css = (vars: Record<string, string | number>) => vars as CSSProperties;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isNarrow = () => window.matchMedia("(max-width: 960px)").matches;
/** The line on screen a step has to pass to become the active one. */
const readingLine = () => window.innerHeight * (isNarrow() ? 0.74 : 0.5);
/** The point of a step that is compared with the reading line. */
const stepAnchor = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return isNarrow() ? r.top + 40 : r.top + r.height / 2;
};

export default function LandingPage() {
  const user = useUser();
  const ml = useMasterList();
  const signedIn = Boolean(user);
  const workspaceHref = signedIn ? (ml === null ? "/master-list" : "/invoices") : "/sign-in";
  const ctaLabel = signedIn ? "Open workspace" : "Sign in to workspace";

  const [stage, setStage] = useState<Stage>(0);
  const [sampleId, setSampleId] = useState<Sample["id"]>("hose");
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const steps = useRef<(HTMLElement | null)[]>([]);

  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];

  // The stage follows the scroll position: a step is active once its text passes the reading line.
  // A click on a step sets it at once and holds it while the page scrolls there, so it never lags behind.
  const lock = useRef<Stage | null>(null);
  const idle = useRef(0);
  const release = useRef<() => void>(() => {});

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      let next: Stage = 0;
      steps.current.forEach((el, i) => {
        if (el && stepAnchor(el) <= readingLine() + 4) next = i as Stage;
      });
      setStage(next);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onScroll = () => {
      if (lock.current === null) return queue();
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => release.current(), 160);
    };
    release.current = () => {
      lock.current = null;
      queue();
    };
    const letGo = () => release.current();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", queue);
    window.addEventListener("wheel", letGo, { passive: true });
    window.addEventListener("touchstart", letGo, { passive: true });
    window.addEventListener("keydown", letGo);
    queue();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", queue);
      window.removeEventListener("wheel", letGo);
      window.removeEventListener("touchstart", letGo);
      window.removeEventListener("keydown", letGo);
      window.clearTimeout(idle.current);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const goTo = (i: Stage) => {
    lock.current = i;
    setStage(i);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => release.current(), 250);
    const el = steps.current[i];
    if (!el) return;
    // Land a little past the reading line, so the step is unambiguously the active one.
    const top = i === 0 ? 0 : Math.max(0, window.scrollY + stepAnchor(el) - (readingLine() - 24));
    window.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
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
          <section
            className="lp-step lp-step--0"
            ref={(el) => {
              steps.current[0] = el;
            }}
            aria-labelledby="lp-h1" data-step="0"
          >
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

          <section
            className="lp-step"
            ref={(el) => {
              steps.current[1] = el;
            }}
            aria-labelledby="lp-h2a" data-step="1"
          >
            <h2 id="lp-h2a" className="lp-h2">
              Every line. Checked.
            </h2>
            <p className="lp-lead">Over the sheet price? Amber. Not sure? It asks you.</p>
          </section>

          <section
            className="lp-step"
            ref={(el) => {
              steps.current[2] = el;
            }}
            aria-labelledby="lp-h2b" data-step="2"
          >
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
  stage: Stage;
  sample: Sample;
  onSample: (id: Sample["id"]) => void;
  onStage: (i: Stage) => void;
  decided: boolean;
  onDecide: (v: boolean) => void;
}) {
  const checked = stage > 0;

  return (
    <div className="lp-card" data-result={sample.result}>
      <div className="lp-progress" role="group" aria-label="Steps">
        {STAGE_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="lp-prog"
            aria-pressed={stage === i}
            data-done={stage > i}
            onClick={() => onStage(i as Stage)}
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
          <Icon name={checked ? "doc" : "mail"} />
          <span>{checked ? sample.file : "New from Outlook"}</span>
        </span>
      </div>

      <Sheet key={sample.id} sample={sample} checked={checked} />

      <div className="lp-foot" aria-live="polite">
        {!checked ? (
          <span className="lp-arrived">
            <span className="lp-hint">Not checked yet</span>
            <button type="button" className="ic-btn ic-btn--primary" onClick={() => onStage(1)}>
              Check this invoice
              <Icon name="arrowR" arrow />
            </button>
          </span>
        ) : stage === 1 ? (
          <span className="lp-sum" key={sample.id}>
            <span className={`ic-pill ic-pill--${sample.result === "ready" ? "good" : "warn"}`}>{sample.summary}</span>
            <small>Checked in {sample.time}</small>
          </span>
        ) : (
          <Decide sample={sample} decided={decided} onDecide={onDecide} />
        )}
      </div>
    </div>
  );
}

/**
 * The invoice sheet and the findings under it. Mounted once per sample, so it starts unchecked and
 * the verdicts play in when it goes live. Rows never change size; only colour, opacity and scale move.
 */
function Sheet({ sample, checked }: { sample: Sample; checked: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  const live = checked && armed;

  return (
    <>
      <div className="lp-sheet" data-live={live}>
        <div className="lp-sheet-head">
          <b>{sample.supplier}</b>
          <span>
            {sample.currency} · {sample.lines.length + (sample.more ? 5 : 0)} lines
          </span>
        </div>

        <div className="lp-rows">
          {live ? <span className="lp-beam" aria-hidden="true" /> : null}
          {sample.lines.map((l, i) => (
            <div key={l.name} className="lp-row" data-v={l.verdict} style={css({ "--i": i })}>
              <span className="lp-mark" aria-hidden="true">
                <Icon name={l.verdict === "match" ? "check" : l.verdict === "over" ? "warn" : "people"} />
              </span>
              <span className="lp-name">
                {l.name}
                <small>{l.qty}</small>
              </span>
              <span className="lp-price">{l.invoice}</span>
              <span className="lp-verdict">
                <span className="lp-wait" aria-hidden="true" />
                <span className={`ic-pill ${l.verdict === "match" ? "ic-pill--good" : "ic-pill--warn"}`} aria-hidden={!live}>
                  <span className="lp-long">{l.pill ?? "Matches"}</span>
                  <span className="lp-short">{l.short ?? "Matches"}</span>
                </span>
              </span>
            </div>
          ))}
          {sample.more ? (
            <div className="lp-row lp-row--more" data-v="match" style={css({ "--i": sample.lines.length })}>
              <span className="lp-mark" aria-hidden="true">
                <Icon name="check" />
              </span>
              <span className="lp-name">{sample.more}</span>
              <span className="lp-price" />
              <span className="lp-verdict">
                <span className="lp-wait" aria-hidden="true" />
                <span className="ic-pill ic-pill--good" aria-hidden={!live}>
                  Match
                </span>
              </span>
            </div>
          ) : null}
        </div>

        <dl className="lp-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{sample.totals.subtotal}</dd>
          </div>
          <div>
            <dt>Tax {sample.totals.rate}</dt>
            <dd>{sample.totals.tax}</dd>
          </div>
          <div>
            <dt>Total {sample.currency}</dt>
            <dd>{sample.totals.total}</dd>
          </div>
        </dl>
      </div>

      <div className="lp-find" data-live={live} data-result={sample.result}>
        <span className="lp-find-idle">Nothing checked yet. Findings appear here.</span>
        <div className="lp-find-body">
          {sample.result === "raise" ? (
            <div className="lp-cmp">
              <span className="lp-cmp-k">Invoice</span>
              <span className="lp-cmp-bar">
                <i style={{ width: "91.9%" }} />
                <i className="over" style={{ width: "8.1%" }} />
              </span>
              <b>74.25</b>
              <span className="lp-cmp-k">Sheet</span>
              <span className="lp-cmp-bar">
                <i style={{ width: "91.9%" }} />
              </span>
              <b>68.25</b>
              <small className="lp-cmp-note">5% discount applied</small>
            </div>
          ) : sample.result === "person" ? (
            <div className="lp-smudge">
              <code>A14L-0156-0001#24R</code>
              <span>Part code unclear on the scan. Nothing guessed.</span>
            </div>
          ) : (
            <div className="lp-allgood">
              <Icon name="check" />
              Every line matches the sheet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Decide({ sample, decided, onDecide }: { sample: Sample; decided: boolean; onDecide: (v: boolean) => void }) {
  if (decided) {
    const ready = sample.result === "ready";
    return (
      <span className="lp-done">
        <span className={`ic-pill ${ready ? "ic-pill--good" : "ic-pill--warn"}`}>{ready ? "Ready to pay" : "Raise with supplier"}</span>
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
      <span className="lp-actions">
        <button type="button" className="ic-btn ic-btn--primary" onClick={() => onDecide(true)}>
          Ready to pay
          <Icon name="check" />
        </button>
      </span>
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
  const [play, setPlay] = useState(false);
  const [found, setFound] = useState(PLANTED);

  // Everything is drawn in its final state. Scrolling the board into view only replays it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || reducedMotion()) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setPlay(true);
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // The counter climbs as each changed invoice lands.
  useEffect(() => {
    if (!play) return;
    const timers: number[] = [window.setTimeout(() => setFound(0), 0)];
    BOARD.forEach((_, r) => {
      timers.push(window.setTimeout(() => setFound(r + 1), r * 260 + 130 + 200 + 450));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [play]);

  return (
    <section className="lp-proof" aria-labelledby="lp-proof-h">
      <div className="lp-proof-in" ref={ref}>
        <div className="lp-proof-top">
          <h2 id="lp-proof-h" className="lp-h2">
            7 wrong prices hidden. 7 found.
          </h2>
          <p className="lp-lead">14 mock invoices: each of 7 layouts once clean, once with one price changed.</p>
        </div>

        <div className={`lp-board${play ? " play" : ""}`} role="table" aria-label="Result for each mock invoice">
          <div className="lp-board-row lp-board-head" role="row">
            <span role="columnheader">Layout</span>
            <span role="columnheader">Clean invoice</span>
            <span role="columnheader">One price changed</span>
          </div>
          {BOARD.map((row, r) => (
            <div key={row.layout} className="lp-board-row" role="row">
              <span className="lp-board-name" role="rowheader">
                {row.layout}
              </span>
              {([row.clean, row.changed] as Cell[]).map((c, k) => (
                <div key={k} className="lp-cell" role="cell" data-kind={c.kind} style={css({ "--d": `${r * 260 + k * 130 + 200}ms`, "--w": `${(c.sec / MAX_SECONDS) * 100}%` })}>
                  <span className="lp-cell-badge" aria-hidden="true">
                    <Icon name={CELL_ICON[c.kind]} />
                  </span>
                  <span className="lp-cell-text">{c.text}</span>
                  <span className="lp-cell-sec">{c.sec.toFixed(1)} s</span>
                  <span className="lp-cell-bar" aria-hidden="true">
                    <i />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <p className="lp-score" aria-live="polite">
          <span>
            <b>{found} of {PLANTED}</b> wrong prices found
          </span>
          <span>
            <b>0</b> false alarms
          </span>
          <span>
            Average <b>6.3 s</b> per invoice
          </span>
        </p>
        <p className="lp-fine">
          Bar length is seconds to check, out of {MAX_SECONDS}. Measured 26 Oct 2026 on 14 synthetic mock invoices, 58 lines. Check time excludes reading the scan.
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- */

function Close({ workspaceHref, ctaLabel }: { workspaceHref: string; ctaLabel: string }) {
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

      <div className="lp-contact">
        <h3>Bring your invoices.</h3>
        <p className="lp-lead">Upload PDF or Vietnamese HDon XML invoices, or a ZIP/RAR batch.</p>
        <p className="lp-fine">After the complete batch uploads, checking continues on the server. Come back later to review the results.</p>
      </div>
    </section>
  );
}
