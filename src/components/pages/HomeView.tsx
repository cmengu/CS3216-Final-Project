"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CustomerMark, Lbl } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canEdit, canPrice, seesCustomer, visibleOrders } from "@/platform/access";
import { mailbox } from "@/platform/nav";
import { TODAY } from "@/sample";
import type { DemoState, Order, Person } from "@/sample";
import { meOf, update, useDemo } from "@/state/demo-store";
import { markGreeted, shouldGreet } from "@/state/session";
import { addDays, dayLabel, evIcon, fmtDay, isOverdue, lc, money, orderTotal, ref, relDay, slotText } from "@/lib/format";

/** The Handover digest, one line per item, as plain text. */
export function digestLines(s: DemoState, u: Person, mine: Order[]): string[] {
  const c = (o: Order) => s.customers[o.cust];
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

export function HomeView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [greet] = useState(shouldGreet);
  useEffect(markGreeted, []);

  const cust = (o: Order) => s.customers[o.cust];
  const mine = visibleOrders(s.orders, u);
  const edit = canEdit(u);
  const waiting = edit ? s.toCheck : [];
  const overdue = mine.filter(isOverdue);
  const sched = mine
    .filter((o) => o.date >= TODAY && o.state !== "delivered")
    .sort((a, b) => a.date.localeCompare(b.date) || a.cust.localeCompare(b.cust));
  const days = [...new Set(sched.map((o) => o.date))].slice(0, 2);
  const need = overdue.length + waiting.length;
  const toInv = mine.filter((o) => o.state === "delivered" && !o.invoiced);
  const formal =
    u.role === "finance"
      ? toInv.length
        ? `${toInv.length} order${toInv.length > 1 ? "s" : ""} to invoice · ${money(toInv.reduce((a, o) => a + orderTotal(o), 0))}`
        : "Nothing to invoice"
      : need
        ? `${need} order${need > 1 ? "s" : ""} awaiting review`
        : "No orders awaiting review";
  const names = (os: Order[]) => [...new Set(os.map((o) => cust(o).name))].join(", ");
  const liveO = (d: string) => mine.filter((o) => o.date === d && o.state !== "delivered");
  const later = mine.filter((o) => o.date > addDays(TODAY, 1) && o.date <= addDays(TODAY, 6) && o.state !== "delivered");
  const mods: [string, Order[]][] = [
    ["Today", liveO(TODAY)],
    ["Tomorrow", liveO(addDays(TODAY, 1))],
    ["Later this week", later],
  ];
  const byId = (id: string) => s.orders.find((o) => o.id === id);
  const recent = s.events
    .filter((e) => {
      const o = byId(e.order);
      return e.kind !== "price_viewed" && !!o && seesCustomer(u, o.cust);
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const mail = mailbox(s);

  const row = (o: Order, title: ReactNode, sub: ReactNode, key: string) => (
    <Link className="it" href={`/orders/${o.id}`} key={key}>
      <CustomerMark c={cust(o)} />
      <span className="t">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      <span className="r">
        <Lbl state={o.state} />
      </span>
    </Link>
  );

  const handover = () => shell.copyText(digestLines(s, u, mine).join("\n"), "Copied handover");

  return (
    <>
      <Header
        icon="home"
        acts={
          <>
            <button className="btn s g" onClick={handover}>
              <Icon name="copy" />
              Handover
            </button>
            {edit ? (
              <Link className="btn p s" href="/add">
                <Icon name="plus" />
                Add orders
              </Link>
            ) : null}
          </>
        }
      >
        {fmtDay(TODAY)}
      </Header>
      <div className="body home">
        <div className="hmain">
          <p className={`lead${greet ? " greet" : ""}`}>
            <span className="hi">Hi {u.name.split(" ")[0]}</span>
            <span className="fm">{formal}</span>
          </p>
          <div className="mods">
            {mods.map(([k, os]) => (
              <Link className="mod" href="/orders" key={k}>
                <span className="k">{k}</span>
                <span className="v">{os.length}</span>
                <span className="m">{os.length ? names(os) : "No deliveries"}</span>
              </Link>
            ))}
          </div>
          {edit && mail.length ? (
            <Link className="mailrow" href="/add" onClick={() => update((d) => void (d.src = "mail"))}>
              <Icon name="mail" />
              <b>
                {mail.length} new PDF{mail.length > 1 ? "s" : ""} in the orders mailbox
              </b>
              <span className="btn s">Read</span>
            </Link>
          ) : null}
          {need ? (
            <section>
              <h3>Awaiting review</h3>
              <div className="list">
                {overdue.map((o) => row(o, cust(o).name, `${ref(o)} · was due ${fmtDay(o.date)}`, "od" + o.id))}
                {waiting.map((t) => {
                  const o = byId(t.order);
                  if (!o) return null;
                  const why =
                    t.kind === "revision" ? `qty ${t.diff[0].old} → ${t.diff[0].new} on line ${t.diff[0].line + 1}` : t.kind === "cell" ? "one cell has no SKU" : "message to place";
                  return row(o, cust(o).name, `${ref(o)} · ${why}`, t.id);
                })}
              </div>
            </section>
          ) : null}
          {u.role === "finance" && toInv.length ? (
            <section>
              <h3>To invoice</h3>
              <div className="list">{toInv.slice(0, 5).map((o) => row(o, cust(o).name, `${ref(o)} · ${money(orderTotal(o))}`, o.id))}</div>
            </section>
          ) : null}
          <section>
            <h3>
              Going out<Link href="/orders">All orders</Link>
            </h3>
            {days.length ? (
              days.map((d) => (
                <Fragment key={d}>
                  <div className="day">
                    <b>{dayLabel(d)}</b>
                    {fmtDay(d)}
                  </div>
                  <div className="list">
                    {sched.filter((o) => o.date === d).map((o) => row(o, cust(o).name, `${o.lines.length} lines · ${slotText(cust(o))}`, o.id))}
                  </div>
                </Fragment>
              ))
            ) : (
              <div className="hint">No deliveries scheduled.</div>
            )}
          </section>
        </div>
        <aside className="hside">
          <section>
            <h3>History</h3>
            <div className="log tl">
              {recent.map((e, i) => {
                const o = byId(e.order)!;
                return (
                  <Link className={`ev ${e.actor === u.name ? "me" : ""}`} href={`/orders/${o.id}`} key={i}>
                    <span className="ic">
                      <Icon name={evIcon(e.kind)} />
                    </span>
                    <span className="tx">
                      <b>{e.actor}</b>{` ${lc(e.text)}`}
                      <small>{`${ref(o)} · ${relDay(e.at.slice(0, 10))} ${e.at.slice(11)}`}</small>
                    </span>
                  </Link>
                );
              })}
            </div>
            <Link className="btn s more" href="/history">
              Show more
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
