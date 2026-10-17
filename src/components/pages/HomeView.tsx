"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canPrice, visibleOrders } from "@/platform/access";
import { TODAY } from "@/sample";
import type { Customer, DemoState, Order, Person } from "@/sample";
import { meOf, useDemo, useShownEvents } from "@/state/demo-store";
import { addDays, custOf, evIcon, fmtDay, isOverdue, lc, money, orderTotal, ref, STATE } from "@/lib/format";
import { dueCards, eventTime, goingOut, nextActions, recentEvents, relLabel, reviewItems, toneOf, type NextAction } from "./home/home";

/** The Handover digest, one line per item, as plain text. */
export function digestLines(s: DemoState, u: Person, mine: Order[]): string[] {
  const c = (o: Order) => custOf(s.customers, o.cust);
  const tmr = addDays(TODAY, 1);
  const out: string[] = [];
  const tO = mine.filter((o) => o.date === tmr && o.state !== "delivered");
  const nc = mine.filter((o) => o.state === "needs_check");
  const bl = mine.filter((o) => o.state === "blocked");
  const ov = mine.filter(isOverdue);
  out.push(
    `Tomorrow ${tO.length} deliver${tO.length === 1 ? "y" : "ies"}${tO.length ? ": " + tO.map((o) => `${c(o).name} ${ref(o)} (${o.lines.length} lines, ${c(o).slot})`).join("; ") : ""}.`,
  );
  if (nc.length) out.push(`Unconfirmed change ${nc.map((o) => ref(o) + " · " + c(o).name).join(", ")}. Packing still sees the old quantity.`);
  if (bl.length) out.push(`Blocked ${bl.map((o) => ref(o) + " · " + c(o).name).join(", ")}. Export waits on a SKU.`);
  if (ov.length) out.push(`Overdue ${ov.map((o) => ref(o)).join(", ")}.`);
  if (u.role === "finance" || u.role === "owner") {
    const ti = mine.filter((o) => o.state === "delivered" && !o.invoiced);
    out.push(
      `To invoice ${ti.length} delivered order${ti.length === 1 ? "" : "s"}${canPrice(u) ? " · " + money(ti.reduce((a, o) => a + orderTotal(o), 0)) : ""}.`,
    );
  }
  const dr = s.drafts.length;
  if (dr) out.push(`Unsent ${dr} acknowledgement draft${dr > 1 ? "s" : ""}.`);
  return out;
}

/** The customer's own line icon from the data, drawn as a plain grey stroke; a building when it has none. */
function CustIcon({ c }: { c: Customer }) {
  if (!c.logo) return <Icon name="building" style={{ width: 22, height: 22 }} />;
  return <svg className="i hm-ci" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: c.logo }} />;
}

function Pill({ n, tone, noun }: { n: number; tone: "warn" | "neutral"; noun: string }) {
  return (
    <span className={`hm-pill ${tone}`}>
      {n}
      <span className="sr">{` ${noun}${n === 1 ? "" : "s"}`}</span>
    </span>
  );
}

function Card({ id, title, pill, children }: { id: string; title: string; pill?: ReactNode; children: ReactNode }) {
  return (
    <section className="hm-card" aria-labelledby={id}>
      <div className="hm-ch">
        <h2 id={id}>{title}</h2>
        {pill}
      </div>
      {children}
    </section>
  );
}

const Arrow = () => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const CAL = (
  <svg className="i hm-cal" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

const ACT_ICON: Record<NextAction["key"], IconName> = { review: "doc", upload: "arrowUp", discrepancies: "warn" };

export function HomeView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const shownEvents = useShownEvents();

  const cust = (o: Order) => custOf(s.customers, o.cust);
  const mine = visibleOrders(s.orders, u);
  const due = dueCards(s, mine);
  const review = reviewItems(s, u, mine);
  const out = goingOut(mine);
  const actions = nextActions(u, review.length);
  const recent = recentEvents(s, u, shownEvents);
  const toInv = u.role === "finance" ? mine.filter((o) => o.state === "delivered" && !o.invoiced) : [];
  const byId = (id: string) => s.orders.find((o) => o.id === id);

  const handover = () => shell.copyText(digestLines(s, u, mine).join("\n"), "Copied handover");

  return (
    <>
      <Header
        className="hm-hd"
        icon="home"
        title="div"
        acts={
          <button type="button" className="hm-hand" onClick={handover} aria-label="Handover: copy today's digest">
            <Icon name="copy" />
            <span>Handover</span>
          </button>
        }
      >
        {fmtDay(TODAY)}
      </Header>
      <div className="body home hm">
        <div className="hm-main">
          <h1 className="hm-h1">Welcome back, {u.name.split(" ")[0]}</h1>

          <section className="hm-due" aria-label="Due dates">
            {due.map((d) => (
              <Link className="hm-dc" href={`/orders?due=${d.key}`} key={d.key}>
                {CAL}
                <span className="hm-dt">
                  <span className="k">{d.label}</span>
                  <span className="v">{d.count}</span>
                  <span className="m">{d.names.length ? d.names.join(", ") : "Nothing due"}</span>
                </span>
              </Link>
            ))}
          </section>

          <Card id="hm-review" title="Awaiting review" pill={<Pill n={review.length} tone="warn" noun="order" />}>
            {review.length ? (
              <div className="hm-tbl" role="table" aria-labelledby="hm-review">
                <div className="hm-tr hm-th" role="row">
                  <span role="columnheader">Customer / Order</span>
                  <span role="columnheader">Issue</span>
                  <span role="columnheader" className="r">
                    Action
                  </span>
                </div>
                {review.map((r) => (
                  <div className="hm-tr" role="row" key={r.key}>
                    <div className="c-who" role="cell">
                      <CustIcon c={cust(r.order)} />
                      <span className="hm-nm">
                        <b>{cust(r.order).name}</b>
                        <small>{ref(r.order)}</small>
                      </span>
                    </div>
                    <div className="c-det" role="cell">
                      {r.issue}
                    </div>
                    <div className="c-act r" role="cell">
                      <Link className="hm-go" href={`/orders/${r.order.id}`} aria-label={`${r.action} ${cust(r.order).name} ${ref(r.order)}`}>
                        {r.action}
                        <Arrow />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hm-empty">Nothing is waiting for review.</p>
            )}
          </Card>

          <Card id="hm-out" title="Going out" pill={<Pill n={out.length} tone="neutral" noun="order" />}>
            {out.length ? (
              <div className="hm-tbl" role="table" aria-labelledby="hm-out">
                <div className="hm-tr hm-th" role="row">
                  <span role="columnheader">Customer</span>
                  <span role="columnheader">Schedule</span>
                  <span role="columnheader" className="r">
                    Status
                  </span>
                </div>
                {out.map((o) => (
                  <div className="hm-tr" role="row" key={o.id}>
                    <div className="c-who" role="cell">
                      <CustIcon c={cust(o)} />
                      <span className="hm-nm">
                        <Link href={`/orders/${o.id}`} className="hm-link">
                          {cust(o).name}
                        </Link>
                      </span>
                    </div>
                    <div className="c-det hm-sch" role="cell">
                      <span>{relLabel(o)}</span>
                      <small>{fmtDay(o.date)}</small>
                    </div>
                    <div className="c-act r" role="cell">
                      <span className={`hm-pill ${toneOf(o.state)}`}>{STATE[o.state][1]}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hm-empty">Nothing is going out in the next seven days.</p>
            )}
          </Card>

          {u.role === "finance" ? (
            <Card id="hm-inv" title="To invoice" pill={<Pill n={toInv.length} tone="neutral" noun="order" />}>
              {toInv.length ? (
                <ul className="hm-list">
                  {toInv.slice(0, 5).map((o) => (
                    <li key={o.id}>
                      <CustIcon c={cust(o)} />
                      <span className="hm-nm">
                        <Link href={`/orders/${o.id}`} className="hm-link">
                          {cust(o).name}
                        </Link>
                        <small>{ref(o)}</small>
                      </span>
                      <span className="hm-amt">{money(orderTotal(o))}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hm-empty">Every delivered order is invoiced.</p>
              )}
            </Card>
          ) : null}
        </div>

        <aside className="hm-side" aria-label="Next actions and recent activity">
          <Card id="hm-next" title="Next actions">
            {actions.length ? (
              <ul className="hm-acts">
                {actions.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href}>
                      <Icon name={ACT_ICON[a.key]} />
                      <span className="t">{a.title}</span>
                      {a.count ? <Pill n={a.count} tone="warn" noun="order" /> : null}
                      <Icon name="chev" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hm-empty">No actions for your role right now.</p>
            )}
          </Card>

          <Card id="hm-act" title="Recent activity">
            {recent.length ? (
              <ol className="hm-tl">
                {recent.map((e, i) => {
                  const o = byId(e.order)!;
                  return (
                    <li key={i}>
                      <span className="ic" aria-hidden="true">
                        <Icon name={evIcon(e.kind)} />
                      </span>
                      <span className="tx">
                        {`${e.actor} ${lc(e.text)}`}
                        <small>{`${ref(o)} · ${eventTime(e.at)}`}</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="hm-empty">No activity yet.</p>
            )}
            <Link className="hm-go hm-more" href="/history">
              View all activity
              <Arrow />
            </Link>
          </Card>
        </aside>
      </div>
    </>
  );
}
