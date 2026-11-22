"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { useUser } from "@/auth";
import { Icon } from "@/components/icons";
import { sendContact, type ContactForm } from "@/lib/contact";
import "./landing.css";

/* ---------------------------------------------------------------------------
   Use cases are real invoices from data/mock_invoice_dataset (synthetic); figures come from its answer key
   and the 26 Oct 2026 benchmark (docs/review/2026-10-26-model-benchmark.md).
   Base styles are the finished state; landing.css only animates the "before".
   --------------------------------------------------------------------------- */

const QUESTIONS: [string, string][] = [
  ["Is my invoice sent to ChatGPT or another AI service?", "No. Reading and filling in your invoice runs on open models we host ourselves. Your invoices are never sent to an outside AI API."],
  ["What if the scan is faint or skewed?", "Scanned PDFs are read with OCR. A line that cannot be read clearly is marked Needs you, with the reason. Nothing is filled in by guesswork."],
  ["Does it email my supplier?", "No. Raise with supplier gives you a dispute note to copy. Nothing is sent from the app."],
  ["Which files can I upload?", "PDF invoices up to 20 MiB and 30 pages, Vietnamese HDon XML, or a ZIP or RAR batch. Up to 10,000 invoices in one go."],
  ["Who can see my invoices?", "Only you. Each approved account has its own private workspace. Administrators manage accounts but cannot open your invoices."],
  ["What does Ready to pay promise?", "The check finished, and every line matches your master list. If anything is unsure, Ready to pay is not offered."],
];

/* Small line icons drawn in the landing page's own colour. */
const Svg = ({ d }: { d: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);
const MAIL = <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>;
const PDF = <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>;
const XML = <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />;
const ZIP = <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 3v4M12 9v2M12 13v2" /></>;
const SERVER = <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>;
const CLOUD = <path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5z" />;
const TICK = <path d="m5 12 5 5 9-10" />;
const CROSS = <path d="M6 6l12 12M18 6 6 18" />;

export default function LandingPage() {
  const user = useUser();
  const signedIn = Boolean(user);
  const workspaceHref = signedIn ? "/invoices" : "/sign-in";
  const ctaLabel = signedIn ? "Open workspace" : "Sign in to workspace";

  const [openQ, setOpenQ] = useState(0);

  return (
    <div className="lp">
      <div className="lp-navwrap">
        <header className="lp-nav">
          <Brand />
          <nav className="lp-nav-links" aria-label="Page">
            <a href="#cases">Use cases</a>
            <a href="#privacy">Privacy</a>
            <a href="#start">How to start</a>
            <a href="#faq">Questions</a>
            <a href="#contact">Contact</a>
          </nav>
          {signedIn ? (
            <Link className="lp-btn lp-btn--glow lp-btn--sm" href={workspaceHref}>
              Open workspace
            </Link>
          ) : (
            <span className="lp-nav-ctas">
              <Link className="lp-nav-signin" href={workspaceHref}>Sign in</Link>
              <a className="lp-btn lp-btn--glow lp-btn--sm" href="#contact">Contact sales</a>
            </span>
          )}
        </header>
      </div>

      <main>
        <Hero ctaLabel={ctaLabel} workspaceHref={workspaceHref} signedIn={signedIn} />
        <UseCases />
        <Privacy />
        <Steps />
        <Questions open={openQ} onToggle={(i) => setOpenQ((o) => (o === i ? -1 : i))} />
        <Close ctaLabel={ctaLabel} workspaceHref={workspaceHref} />
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <Brand />
          <span>All invoices, names and prices on this page are synthetic.</span>
          <span className="lp-chip lp-glass lp-mono">
            <span className="lp-dot lp-dot--good" />
            Self-hosted models · no outside AI
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function Hero({ ctaLabel, workspaceHref, signedIn }: { ctaLabel: string; workspaceHref: string; signedIn: boolean }) {
  return (
    <section className="lp-hero lp-mesh-ink" aria-labelledby="lp-h1">
      <div className="lp-hero-in">
        <div className="lp-hero-top lp-a-hero-title">
          <span className="lp-chip lp-glass lp-mono">
            <span className="lp-dot lp-dot--good" />
            Built for accounts payable
          </span>
          <h1 id="lp-h1" className="lp-h1 lp-display">
            <span>Know before</span>
            <span className="lp-serif lp-shine">you pay.</span>
          </h1>
          <p className="lp-lead">
            Every invoice line, checked against the price you agreed. <b>Unsure lines come to you.</b>
          </p>
          <div className="lp-ctas">
            {signedIn ? (
              <Link className="lp-btn lp-btn--glow" href={workspaceHref}>
                {ctaLabel}
                <Icon name="arrowR" arrow />
              </Link>
            ) : (
              <>
                <a className="lp-btn lp-btn--glow" href="#contact">
                  Contact sales
                  <Icon name="arrowR" arrow />
                </a>
                <a className="lp-btn lp-btn--white" href="#cases">
                  See real cases ↓
                </a>
              </>
            )}
          </div>
        </div>

        <div className="lp-flow">
          <div className="lp-flow-col lp-flow-col--src">
            <span className="lp-mono">Comes in from</span>
            <span className="lp-src lp-glass"><Svg d={MAIL} />Outlook inbox</span>
            <span className="lp-src lp-glass"><Svg d={PDF} />PDF, even scanned</span>
            <span className="lp-src lp-glass"><Svg d={XML} />HDon XML</span>
            <span className="lp-src lp-glass"><Svg d={ZIP} />ZIP or RAR batch</span>
          </div>

          <div className="lp-link" aria-hidden="true">
            <i style={{ left: 0, top: 29, width: 40, height: 1 }} />
            <i style={{ left: 0, top: 99, width: 40, height: 1 }} />
            <i style={{ left: 0, top: 169, width: 40, height: 1 }} />
            <i style={{ left: 0, top: 239, width: 40, height: 1 }} />
            <i style={{ left: 40, top: 29, width: 1, height: 211 }} />
            <i className="hot" style={{ left: 40, top: 134, width: 24 }} />
          </div>

          <div className="lp-a-hero-card">
            <div className="lp-inv lp-ring">
              <div className="lp-inv-head">
                <span>
                  <b>DEF Hose Company</b>
                </span>
                <span className="lp-pill lp-pill--bad">Over by SGD 159.60</span>
              </div>
              <div className="lp-row lp-row--over">
                <span><span>1 inch SS hose, 237 mm</span><small>28 LG</small></span>
                <span className="lp-num">74.25</span>
                <span className="lp-pill lp-pill--bad-solid">Over</span>
              </div>
              <div className="lp-row">
                <span><span>1 inch SS hose, 195 mm</span><small>18 LG</small></span>
                <span className="lp-num">72.40</span>
                <span className="lp-pill lp-pill--good">Matches</span>
              </div>
              <div className="lp-inv-foot">
                <span className="lp-mono">Checked in 5.4 s</span>
                <span className="lp-btn lp-btn--glow lp-btn--sm" aria-hidden="true">Raise with supplier</span>
              </div>
            </div>
          </div>

          <div className="lp-link" aria-hidden="true" style={{ height: 252 }}>
            <i style={{ left: 0, top: 126, width: 24, height: 1 }} />
            <i style={{ left: 24, top: 38, width: 1, height: 177 }} />
            <i style={{ left: 24, top: 38, width: 40, height: 1 }} />
            <i className="hot" style={{ left: 24, top: 126, width: 40 }} />
            <i style={{ left: 24, top: 214, width: 40, height: 1 }} />
          </div>

          <div className="lp-flow-col">
            <span className="lp-mono">Ends one of three ways</span>
            <a className="lp-end lp-glass lp-lift" href="#cases">
              <b><span className="lp-dot lp-dot--good" />Ready to pay</b>
              <span>Every line matches</span>
            </a>
            <a className="lp-end lp-mesh-terra lp-lift" href="#cases">
              <b>Raise with supplier</b>
              <span>A line is over the sheet</span>
            </a>
            <a className="lp-end lp-glass lp-lift" href="#cases">
              <b><span className="lp-dot lp-dot--warn" />Pay anyway</b>
              <span>With a reason you give</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

type Tone = "bad" | "warn" | "good";
type PaperLine = { text: ReactNode; qty: string; price: string; mark?: Tone };
type UseCase = {
  tone: Tone;
  source: string;
  title: ReactNode;
  paperHead: [string, string];
  lines: PaperLine[];
  pill: string;
  facts: [string, ReactNode][];
  outcome: string;
  note: string;
};

/* Each case is a real invoice from data/mock_invoice_dataset; figures are from its answer key or the 26 Oct benchmark. */
const CASES: UseCase[] = [
  {
    tone: "bad",
    source: "Hose · F02_hose_tax_02.pdf",
    title: <>The price <span className="lp-serif">crept up.</span></>,
    paperHead: ["DEF HOSE CO.", "INVOICE"],
    lines: [
      { text: "1in SS hose 195mm", qty: "18 LG", price: "72.40" },
      { text: "1in SS hose 237mm", qty: "28 LG", price: "74.25", mark: "bad" },
    ],
    pill: "Over by SGD 159.60",
    facts: [["Invoice", <b key="i" className="bad">74.25</b>], ["Agreed", <b key="a">68.25</b>]],
    outcome: "Raise with supplier",
    note: "Dispute note, ready to copy",
  },
  {
    tone: "warn",
    source: "Service · F04_service_tax_02.pdf",
    title: <>Charged <span className="lp-serif">less</span> than agreed.</>,
    paperHead: ["JKL MACHINE SVCS", "INVOICE"],
    lines: [
      { text: "Power supply", qty: "2 PCE", price: "312.60" },
      { text: "Engineer, 1st hour", qty: "1 HR", price: "142.50" },
      { text: "Engineer, extra hours", qty: "3 HR", price: "80.25", mark: "warn" },
    ],
    pill: "Under by SGD 21.00",
    facts: [["Invoice", <b key="i" className="warn">80.25</b>], ["Agreed", <b key="a">87.25</b>]],
    outcome: "Pay anyway",
    note: "With your reason, kept on record",
  },
  {
    tone: "warn",
    source: "Service · F04_service_tax_01.pdf",
    title: <>The scan was <span className="lp-serif">unclear.</span></>,
    paperHead: ["JKL MACHINE SVCS", "INVOICE"],
    lines: [
      { text: "Power supply", qty: "1 PCE", price: "312.60" },
      { text: <span className="lp-smudge">A14L-0156… Engineer 1st hr</span>, qty: "1 HR", price: "142.50", mark: "warn" },
      { text: "Engineer, extra hours", qty: "2 HR", price: "87.25" },
    ],
    pill: "Needs you",
    facts: [["Code read", <b key="c">A14L-…#24R</b>], ["Fits this line?", <b key="f" className="warn">No</b>]],
    outcome: "You check the line",
    note: "Nothing is guessed",
  },
  {
    tone: "good",
    source: "Freight · F01_freight_tax_01.pdf",
    title: <>Everything was <span className="lp-serif">right.</span></>,
    paperHead: ["ABC LOGISTICS", "INVOICE"],
    lines: [
      { text: "Freight", qty: "2.4 M3", price: "111.35", mark: "good" },
      { text: "Bunker surcharge", qty: "2.4 M3", price: "18.34", mark: "good" },
      { text: "General rate increase", qty: "2.4 M3", price: "23.58", mark: "good" },
      { text: "Origin local fee", qty: "1 JOB", price: "221.40", mark: "good" },
    ],
    pill: "All 7 lines match",
    facts: [["Lines checked", <b key="l">7 of 7</b>], ["Total", <b key="t">SGD 642.75</b>]],
    outcome: "Ready to pay",
    note: "Added to the CSV for your payment run",
  },
];

function UseCases() {
  return (
    <section id="cases" className="lp-cases" aria-labelledby="lp-cases-h">
      <div className="lp-cases-in">
        <div className="lp-cases-top lp-a-rise">
          <span className="lp-mono">Use cases</span>
          <h2 id="lp-cases-h" className="lp-h2 lp-display">
            What it <span className="lp-serif lp-shine-ink">catches.</span>
          </h2>
        </div>
        <div className="lp-case-grid">
          {CASES.map((c) => (
            <article key={c.source} className="lp-case lp-inv lp-ring-soft lp-lift lp-a-rise">
              <div className="lp-case-head">
                <h3>{c.title}</h3>
              </div>
              <div className={`lp-case-art lp-case-art--${c.tone}`} role="img" aria-label={`${c.pill}. ${c.facts.map(([k]) => k).join(", ")} shown.`}>
                <div className="lp-paper" aria-hidden="true">
                  <div className="lp-paper-head">
                    <b>{c.paperHead[0]}</b>
                    <span>{c.paperHead[1]}</span>
                  </div>
                  <span className="lp-ghost" style={{ width: "62%" }} />
                  {c.lines.map((l, i) => (
                    <div key={i} className={`lp-pline${l.mark ? ` lp-pline--${l.mark}` : ""}`}>
                      <span>{l.text}</span>
                      <span>{l.qty}</span>
                      <span>{l.price}</span>
                    </div>
                  ))}
                  <span className="lp-ghost" style={{ width: "40%" }} />
                </div>
                <div className="lp-verdict" aria-hidden="true">
                  <span className={`lp-pill lp-pill--${c.tone}`}>{c.pill}</span>
                  {c.facts.map(([k, v]) => (
                    <span key={k} className="lp-vrow">
                      {k}
                      {v}
                    </span>
                  ))}
                </div>
              </div>
              <div className="lp-case-out">
                <Icon name="arrowR" arrow />
                <span className={`lp-out lp-out--${c.tone}`}>{c.outcome}</span>
                <small>{c.note}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="lp-proof" aria-labelledby="lp-priv-h">
      <div className="lp-marquee lp-display" aria-hidden="true">
        <span>PRIVATE · SELF-HOSTED · PRIVATE · SELF-HOSTED ·</span>
        <span>PRIVATE · SELF-HOSTED · PRIVATE · SELF-HOSTED ·</span>
      </div>
      <div className="lp-proof-in">
        <div className="lp-tile lp-glass lp-a-rise">
          <div className="lp-priv">
            <div className="lp-priv-copy">
              <span className="lp-mono" style={{ color: "var(--lp-on-dark-3)" }}>Privacy</span>
              <h2 id="lp-priv-h" className="lp-h2 lp-display">
                Your invoices stay <span className="lp-serif lp-shine">with us.</span>
              </h2>
              <div className="lp-chips">
                <span className="lp-glass"><Svg d={TICK} />Self-hosted models</span>
                <span className="lp-glass"><Svg d={TICK} />Approved accounts only</span>
                <span className="lp-glass"><Svg d={TICK} />Code at every sign-in</span>
              </div>
            </div>
            <div className="lp-map" role="img" aria-label="Your invoice goes only to Linecheck's own server and models. Outside AI APIs are never called.">
              <span className="lp-node lp-glass"><Svg d={PDF} /><span><b>Your invoice</b><small>PDF or XML</small></span></span>
              <span className="lp-wire" />
              <span className="lp-node lp-node--home lp-mesh-terra"><Svg d={SERVER} /><span><b>Our server</b><small>Our own models</small></span></span>
              <span className="lp-nope"><Svg d={CROSS} />Never called</span>
              <span className="lp-node lp-node--out"><Svg d={CLOUD} /><span><b>Outside AI APIs</b><small>ChatGPT and others</small></span></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section id="start" aria-labelledby="lp-steps-h">
      <div className="lp-steps-in">
        <h2 id="lp-steps-h" className="lp-h2 lp-display lp-a-rise">
          Set up once. Then <span className="lp-serif lp-shine-ink">seconds</span> per invoice.
        </h2>
        <ol className="lp-steps-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          <li className="lp-step lp-step--blue lp-lift lp-a-rise">
            <div className="lp-step-art" aria-hidden="true">
              <div className="lp-sheet">
                <span><i>PART</i><i>PRICE</i></span>
                <span><i>1in SS hose 195mm</i><i>72.40</i></span>
                <span><i>1in SS hose 237mm</i><i>68.25</i></span>
                <span><i>Engineer, per hour</i><i>87.25</i></span>
              </div>
              <span className="lp-sheet-tag">Columns found ✓</span>
            </div>
            <span className="lp-big lp-display lp-shine-ink" aria-hidden="true">01</span>
            <h3>Upload your master list</h3>
            <p>CSV or Excel. Once.</p>
          </li>
          <li className="lp-step lp-step--amber lp-lift lp-a-rise">
            <div className="lp-step-art" aria-hidden="true">
              <div className="lp-fan">
                <span><i className="lp-ghost" style={{ width: "80%" }} /><i className="lp-ghost" style={{ width: "60%" }} /><b style={{ background: "var(--bad)" }}>PDF</b></span>
                <span><i className="lp-ghost" style={{ width: "70%" }} /><i className="lp-ghost" style={{ width: "86%" }} /><b style={{ background: "var(--info)" }}>XML</b></span>
                <span><i className="lp-ghost" style={{ width: "84%" }} /><i className="lp-ghost" style={{ width: "54%" }} /><b style={{ background: "var(--warn)" }}>ZIP</b></span>
              </div>
            </div>
            <span className="lp-big lp-display lp-shine-ink" aria-hidden="true">02</span>
            <h3>Drop in invoices</h3>
            <p>PDF, XML, ZIP or RAR. Up to 10,000.</p>
          </li>
          <li className="lp-step lp-mesh-ink lp-lift lp-a-rise" style={{ borderColor: "#3a2a21", color: "var(--lp-on-dark)" }}>
            <div className="lp-step-art" aria-hidden="true">
              <div className="lp-choices">
                <span>Ready to pay</span>
                <span>Raise with supplier</span>
                <span>Pay anyway</span>
              </div>
              <svg className="lp-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z" /></svg>
            </div>
            <span className="lp-big lp-display lp-shine" aria-hidden="true">03</span>
            <h3>Decide each one</h3>
            <p style={{ color: "var(--lp-on-dark-2)" }}>Problems first. One click each.</p>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Questions({ open, onToggle }: { open: number; onToggle: (i: number) => void }) {
  return (
    <section id="faq" className="lp-faq" aria-labelledby="lp-faq-h">
      <div className="lp-faq-in">
        <div className="lp-faq-left lp-a-rise">
          <h2 id="lp-faq-h" className="lp-h2 lp-display">
            What clerks ask <span className="lp-serif lp-shine-ink">first.</span>
          </h2>
          <div className="lp-help lp-mesh-ink">
            <b>Still have a question?</b>
            <p>Tell us about your invoices. We reply by email.</p>
            <a className="lp-btn lp-btn--glow lp-btn--sm" href="#contact">
              Contact us
              <Icon name="arrowR" arrow />
            </a>
          </div>
        </div>
        <div className="lp-qs lp-a-rise">
          {QUESTIONS.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <div key={q} className="lp-q" data-open={isOpen}>
                <button type="button" aria-expanded={isOpen} aria-controls={`lp-a-${i}`} onClick={() => onToggle(i)}>
                  <span className="lp-mono">Q{i + 1}</span>
                  <span className="lp-q-text">{q}</span>
                  <span className="lp-q-sign" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                </button>
                <p id={`lp-a-${i}`} hidden={!isOpen}>{a}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Close({ ctaLabel, workspaceHref }: { ctaLabel: string; workspaceHref: string }) {
  return (
    <section id="contact" className="lp-close lp-mesh-band" aria-labelledby="lp-close-h">
      <div className="lp-close-in">
        <div className="lp-close-copy lp-a-rise">
          <h2 id="lp-close-h" className="lp-h1 lp-display">
            <span>Check your</span>
            <span className="lp-serif lp-chrome">next invoice.</span>
          </h2>
          <p>New to Linecheck? Tell us about your invoices and we&apos;ll set your team up. Already a customer? Sign in.</p>
          <Link className="lp-btn lp-btn--cream" href={workspaceHref}>
            {ctaLabel === "Open workspace" ? ctaLabel : "Sign in"}
            <Icon name="arrowR" arrow />
          </Link>
        </div>
        <ContactCard />
      </div>
    </section>
  );
}

const EMPTY: ContactForm = { name: "", email: "", company: "", message: "", website: "" };

function ContactCard() {
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof ContactForm) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      await sendContact(form);
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong sending your message. Please try again.");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div className="lp-form lp-ring-soft lp-a-rise" role="status">
        <div className="lp-sent">
          <span className="lp-sent-tick"><Svg d={TICK} /></span>
          <h3>Thanks, {form.name.split(" ")[0] || "we got it"}.</h3>
          <p className="lp-form-note">We&apos;ll reply to {form.email}.</p>
          <button type="button" className="lp-btn lp-btn--sm" style={{ background: "var(--panel2)", color: "var(--ink)" }} onClick={() => { setForm(EMPTY); setState("idle"); }}>
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="lp-form lp-ring-soft lp-a-rise" onSubmit={submit} aria-labelledby="lp-form-h">
      <h3 id="lp-form-h">Contact sales</h3>
      <div className="lp-form-row">
        <label className="lp-field">
          Name
          <input name="name" autoComplete="name" required maxLength={100} {...field("name")} />
        </label>
        <label className="lp-field">
          Work email
          <input name="email" type="email" autoComplete="email" required maxLength={254} {...field("email")} />
        </label>
      </div>
      <label className="lp-field">
        <span>Company <small>(optional)</small></span>
        <input name="company" autoComplete="organization" maxLength={120} {...field("company")} />
      </label>
      <label className="lp-field">
        Message
        <textarea name="message" required minLength={10} maxLength={2000} placeholder="How many invoices do you check a month, and what do they look like?" {...field("message")} />
      </label>
      <div className="lp-trap" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" {...field("website")} />
        </label>
      </div>
      <div className="lp-form-foot">
        <span className="lp-form-error" role="alert">{error}</span>
        <button type="submit" className="lp-btn lp-btn--glow" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send"}
          {state === "sending" ? null : <Icon name="arrowR" arrow />}
        </button>
      </div>
      <p className="lp-form-note">We only use your details to reply to you.</p>
    </form>
  );
}
