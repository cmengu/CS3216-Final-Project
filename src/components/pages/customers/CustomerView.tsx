"use client";

/*
 * The customer page: Last 30 days, Open orders, Past orders, Last prices and Activity, with the
 * account panel (Contact, Delivery, Billing, Standing note) beside them. The order page's side
 * pane keeps using Profile.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { NotFound } from "@/components/shell/Guard";
import { Header } from "@/components/shell/Header";
import { PageActions } from "@/components/shell/PageActions";
import { useShell } from "@/components/shell/context";
import { canEdit, canPrice, seesCustomer } from "@/platform/access";
import { PRODUCTS, TODAY } from "@/sample";
import type { Customer, Order } from "@/sample";
import { addNote } from "@/state/actions/customers";
import { meOf, useDemo, useShownEvents } from "@/state/demo-store";
import { evIcon, fmtDay, isOverdue, lc, money, orderTotal, outlets, ref, relDay, STATE } from "@/lib/format";
import { orderIssues } from "@/lib/issues";
import { ACTIVITY_FILTERS, activity, customerOrders, highlights, openOrders, pastOrders, profileFigures, weeksText, type ActivityFilter } from "./figures";

/** The Activity filter, kept for the session and shared by every customer page, as the prototype keeps S._cf. */
let keptFlt: ActivityFilter = "all";
const keepFlt = (f: ActivityFilter) => {
  keptFlt = f;
};

const tone = (o: Order) => (o.state === "confirmed" ? "good" : o.state === "needs_check" || o.state === "blocked" ? "warn" : "neutral");

/** "Tomorrow", "In 4 days", "3 days ago". */
function relative(d: string): string {
  const r = relDay(d);
  if (/^(Today|Tomorrow|Yesterday)$/.test(r)) return r;
  const days = Math.round((new Date(d + "T00:00:00").getTime() - new Date(TODAY + "T00:00:00").getTime()) / 86400000);
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

const Arrow = () => (
  <svg className="i arr" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function Pill({ n, noun }: { n: number; noun: string }) {
  return (
    <span className="cu-pill neutral">
      {n}
      <span className="sr">{` ${noun}${n === 1 ? "" : "s"}`}</span>
    </span>
  );
}

function Card({ id, title, aside, className, children }: { id: string; title: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `cu-card ${className}` : "cu-card"} aria-labelledby={id}>
      <div className="cu-ch">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One order as a table row; open orders get a View order action, past ones link the whole row. */
function OrderRow({ o, price, open }: { o: Order; price: boolean; open: boolean }) {
  const cells = (
    <>
      <span className="c-ord" role="cell">
        {ref(o)}
      </span>
      <span className="c-st" role="cell">
        <span className={`cu-pill ${open ? tone(o) : "neutral"}`}>{STATE[o.state][1]}</span>
        {isOverdue(o) ? <span className="cu-pill warn">Overdue</span> : null}
      </span>
      <span className="c-to" role="cell">
        {outlets(o).join(", ")}
      </span>
      <span className="c-n num" role="cell">
        {o.lines.length}
      </span>
      {price ? (
        <span className="c-amt num" role="cell">
          {money(orderTotal(o))}
        </span>
      ) : null}
      <span className="c-date" role="cell">
        <span>{fmtDay(o.date)}</span>
        {open ? <small>{relative(o.date)}</small> : null}
      </span>
      <span className="c-sum" role="cell">
        {`${outlets(o).join(", ")} · ${o.lines.length} line${o.lines.length === 1 ? "" : "s"}${price ? " · " + money(orderTotal(o)) : ""}`}
      </span>
    </>
  );
  if (open)
    return (
      <div className={`cu-or${price ? "" : " np"}`} role="row">
        {cells}
        <span className="c-act" role="cell">
          <Link className="cu-go" href={`/orders/${o.id}`} aria-label={`View order ${ref(o)}`}>
            <span className="t">View order</span>
            <Arrow />
            <Icon name="chev" />
          </Link>
        </span>
      </div>
    );
  return (
    <Link className={`cu-or past${price ? "" : " np"}`} role="row" href={`/orders/${o.id}`} aria-label={`Order ${ref(o)}, ${STATE[o.state][1]}, ${fmtDay(o.date)}`}>
      {cells}
      <span className="c-act" role="cell">
        <Icon name="chev" />
      </span>
    </Link>
  );
}

function OrderHead({ price, action }: { price: boolean; action: boolean }) {
  return (
    <div className={`cu-or cu-oh${price ? "" : " np"}`} role="row">
      <span role="columnheader">Order</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Delivers to</span>
      <span role="columnheader" className="num">
        Lines
      </span>
      {price ? (
        <span role="columnheader" className="num">
          Amount
        </span>
      ) : null}
      <span role="columnheader">Delivery date</span>
      <span role="columnheader" className="c-act">
        {action ? "Action" : <span className="sr">Open</span>}
      </span>
    </div>
  );
}

/** A fact in the account panel: grey icon, the value, and an optional muted sub-line. */
function Fact({ ic, label, value, sub }: { ic: IconName; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="cu-fact">
      <span className="ic" role="img" aria-label={label}>
        <Icon name={ic} />
      </span>
      <span className="v">
        {value}
        {sub ? <small>{sub}</small> : null}
      </span>
    </div>
  );
}

const missing = (v: string | undefined | null, what: string) => (v && v.trim() && v !== "—" ? v : <span className="cu-none">{`No ${what} on file`}</span>);

function AccountPanel({ c, price }: { c: Customer; price: boolean }) {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [note, setNote] = useState("");
  const f = profileFigures(s, c.id);
  const add = () => {
    if (addNote(c.id, note)) {
      setNote("");
      shell.toast("Note added");
    }
  };
  return (
    <aside className="cu-panel" aria-label="Account details">
      <div className="grp">
        <h3>Contact</h3>
        <Fact ic="people" label="Contact" value={missing(c.sender, "contact")} />
        <Fact ic="mail" label="How POs arrive" value={missing(c.channel, "channel")} sub="How POs arrive" />
        <Fact ic="clock" label="Ordering days" value={c.days && c.days !== "—" ? "Orders " + c.days : missing(null, "ordering days")} sub="Usual days" />
        <button type="button" className="cu-copy" onClick={() => shell.copyText(`${c.sender} · ${c.channel}`, "Copied contact")}>
          <Icon name="copy" />
          Copy contact
        </button>
      </div>
      <div className="grp">
        <h3>Delivery</h3>
        <Fact
          ic="truck"
          label="Delivery location"
          value={missing(c.location, "delivery location")}
          sub={c.slot === "Unspecified" ? "Time to confirm each order" : `${c.slot} slot`}
        />
        {c.outlets.length ? (
          <ul className="cu-tags" aria-label="Delivers to">
            {c.outlets.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="cu-none ind">No delivery destinations on file</p>
        )}
      </div>
      {price ? (
        <div className="grp">
          <h3>Billing</h3>
          <Fact
            ic="inv"
            label="Payment terms"
            value={c.terms && c.terms !== "—" ? `${c.terms} terms` : missing(null, "payment terms")}
            sub={f.lastInv ? `Last ${f.lastInv.invoiced} · ${fmtDay(f.lastInv.date)}` : "No invoices yet"}
          />
          {f.unInv ? <p className="cu-sub ind">{`${f.unInv} delivered order${f.unInv === 1 ? "" : "s"} to invoice`}</p> : null}
        </div>
      ) : null}
      <div className="grp">
        <h3>Standing note</h3>
        {c.notes.length ? c.notes.map((n, i) => <p key={i}>{n}</p>) : <p className="cu-none">No standing note.</p>}
        {canEdit(u) ? (
          <div className="cu-note">
            <label htmlFor={`note-${c.id}`} className="sr">
              Add a standing note
            </label>
            <input id={`note-${c.id}`} placeholder="Add a standing note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button type="button" onClick={add}>
              Add
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function CustomerView({ id }: { id: string }) {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [flt, setFltState] = useState<ActivityFilter>(keptFlt);
  const setFlt = (f: ActivityFilter) => {
    keepFlt(f);
    setFltState(f);
  };
  const shownEvents = useShownEvents();
  const c = s.customers[id];
  if (!c || !seesCustomer(u, id)) return <NotFound />;

  const price = canPrice(u);
  const mine = customerOrders(s, id);
  const open = openOrders(mine).sort((a, b) => a.date.localeCompare(b.date));
  const past = pastOrders(mine);
  const issues = open.flatMap((o) => orderIssues(o, s.toCheck).map((i) => ({ ...i, o })));
  const hl = highlights(s, id);
  const prices = profileFigures(s, id).lastPrice;
  const ev = activity({ ...s, events: shownEvents }, id, flt);
  const byId = (oid: string) => s.orders.find((x) => x.id === oid)!;
  const ask = () => shell.openAssistant({ prompt: `Catch me up on ${c.name}` });

  const stats: [string, string][] = [
    ["Orders", String(hl.orders30)],
    ["Lines", String(hl.lines30)],
    ["Avg lines/order", hl.avgLines],
    ["On time", hl.onTime === null ? "–" : hl.onTime + "%"],
  ];
  if (price) stats.push(["Billed", money(hl.billed30)]);

  return (
    <>
      <Header
        className="cu-hd"
        title="div"
        acts={
          <>
            <button type="button" className="pa-ask" onClick={ask} aria-label={`Ask about ${c.name}`}>
              <Icon name="spark" />
              <span>Ask</span>
            </button>
            <PageActions />
          </>
        }
      >
        <span className="cu-mtitle">{c.name}</span>
      </Header>
      <div className="body cu cu-detail">
        <div className="cu-top">
          <nav aria-label="Breadcrumb" className="cu-crumb">
            <Link href="/customers">Customers</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{c.name}</span>
          </nav>
          <h1 className="cu-h1">{c.name}</h1>
          <span className="cu-kind">
            {`${c.kind || "Customer"} · `}
            <span className="mono">{c.id}</span>
          </span>
        </div>

        <div className="cu-cols">
          <div className="cu-main">
            <Card id="cu-30" title="Last 30 days">
              <dl className={`cu-stats n${stats.length}`}>
                {stats.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="cu-chart">
                <div className="k" id="cu-chart-k">
                  Orders per week
                </div>
                <div className="cu-bars" role="img" aria-label={weeksText(hl.weeks)}>
                  {hl.weeks.map((w) => (
                    <div key={w.start} title={w.title}>
                      <span className="bar">
                        <b className={w.hi ? "hi" : ""} style={{ height: Math.max(w.height, 4) + "%" }} />
                      </span>
                      <span className="lbl">{w.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card id="cu-open" title="Open orders" aside={<Pill n={open.length} noun="order" />}>
              {open.length ? (
                <>
                  <div className="cu-tbl" role="table" aria-labelledby="cu-open">
                    <OrderHead price={price} action />
                    {open.map((o) => (
                      <OrderRow o={o} price={price} open key={o.id} />
                    ))}
                  </div>
                  {issues.length ? (
                    <ul className="cu-issues">
                      {issues.map((i, n) => (
                        <li key={n}>
                          <i aria-hidden="true" />
                          <span>{`${ref(i.o)}: ${i.text}`}</span>
                          <Link className="cu-go" href={`/orders/${i.o.id}`} aria-label={`${i.action} ${ref(i.o)}`}>
                            {i.action}
                            <Arrow />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cu-ok">
                      <Icon name="check" />
                      No issues on open orders
                    </p>
                  )}
                </>
              ) : (
                <p className="cu-empty">No open orders.</p>
              )}
            </Card>

            <Card
              id="cu-past"
              title="Past orders"
              aside={
                <>
                  <Pill n={past.length} noun="order" />
                  <Link className="cu-go cu-all" href={`/orders?customer=${c.id}`}>
                    {`All ${mine.length} orders`}
                    <Arrow />
                  </Link>
                </>
              }
            >
              {past.length ? (
                <div className="cu-tbl" role="table" aria-labelledby="cu-past">
                  <OrderHead price={price} action={false} />
                  {past.map((o) => (
                    <OrderRow o={o} price={price} open={false} key={o.id} />
                  ))}
                </div>
              ) : (
                <p className="cu-empty">No past orders yet.</p>
              )}
            </Card>

            {price ? (
              <Card id="cu-prices" title="Last prices">
                {prices.length ? (
                  <div className="cu-tbl" role="table" aria-labelledby="cu-prices">
                    <div className="cu-pr cu-oh" role="row">
                      <span role="columnheader">Item</span>
                      <span role="columnheader">Order</span>
                      <span role="columnheader" className="num">
                        Price
                      </span>
                    </div>
                    {prices.map(([k, [p, x]]) => (
                      <div className="cu-pr" role="row" key={k}>
                        <span role="cell">{PRODUCTS[k].name}</span>
                        <span role="cell">
                          <Link href={`/orders/${x.id}`} className="cu-ref">
                            {ref(x)}
                          </Link>
                          <small>{` · ${relDay(x.date)}`}</small>
                        </span>
                        <span role="cell" className="num">
                          {money(p)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="cu-empty">No prices yet.</p>
                )}
              </Card>
            ) : null}

            <Card
              id="cu-act"
              title="Activity"
              aside={
                <div className="cu-seg sm" role="group" aria-label="Filter activity">
                  {ACTIVITY_FILTERS.map(([k, l]) => (
                    <button type="button" key={k} aria-pressed={flt === k} onClick={() => setFlt(k)}>
                      {l}
                    </button>
                  ))}
                </div>
              }
            >
              {ev.length ? (
                <ol className="cu-feed">
                  {ev.map((e, i) => {
                    const o = byId(e.order);
                    return (
                      <li key={i}>
                        <span className="ic" aria-hidden="true">
                          <Icon name={evIcon(e.kind)} />
                        </span>
                        <span className="tx">
                          <span>
                            <b>{e.actor}</b>
                            {` ${lc(e.text)}`}
                          </span>
                          <small>
                            <Link href={`/orders/${o.id}`} className="cu-ref">
                              {ref(o)}
                            </Link>
                            {` · ${relDay(e.at.slice(0, 10))} ${e.at.slice(11)}`}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="cu-empty">{flt === "all" ? "No activity yet." : `No ${ACTIVITY_FILTERS.find(([k]) => k === flt)![1].toLowerCase()} yet.`}</p>
              )}
            </Card>
          </div>

          <AccountPanel c={c} price={price} />
        </div>
      </div>
    </>
  );
}

