"use client";

import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { useShell } from "@/components/shell/context";
import { canPrice } from "@/platform/access";
import { PRODUCTS } from "@/sample";
import type { Customer, DemoState, Order, Person } from "@/sample";
import { initials, money, ref, relDay, STATE } from "@/lib/format";
import { profileOf, sourceRows } from "./logic";

const Sec = ({ t, children }: { t: string; children: ReactNode }) => (
  <div className="psec">
    <div className="ph2">
      {t} <Icon name="chev" />
    </div>
    {children}
  </div>
);

const Pr = ({ ic, t, sub, r }: { ic: IconName; t: ReactNode; sub?: string; r?: string }) => (
  <div className="pr">
    <span className="ic">
      <Icon name={ic} />
    </span>
    <span className="t">
      {t}
      {sub ? <small>{sub}</small> : null}
    </span>
    {r ? <span className="r">{r}</span> : null}
  </div>
);

/** The customer profile in the order page's side pane, as the prototype's profile(). */
export function Profile({ s, c, u }: { s: DemoState; c: Customer; u: Person }) {
  const shell = useShell();
  const p = profileOf(s, c, u);
  const pr = canPrice(u);
  const style = { "--c": c.color || "#777" } as CSSProperties;
  return (
    <>
      <div className="prof">
        <div className="logo big" style={style}>
          {c.logo ? <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: c.logo }} /> : initials(c.name)}
        </div>
        <h2>
          {c.name}
          <Icon name="check" />
        </h2>
        <div className="sub">
          {c.kind || "Customer"} · <span className="mono">{c.id}</span> · {c.channel.replace(/ \(.*\)/, "")}
        </div>
        <div className="acts">
          <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => shell.copyText(`${c.sender} · ${c.channel}`, "Copied contact")}>
            <Icon name="reply" />
            Message
          </button>
          <button className="btn" title={`Ask about ${c.name}`} onClick={() => shell.openAgent(true, `Catch me up on ${c.name}`)}>
            <Icon name="spark" />
          </button>
        </div>
      </div>
      <div className="pstats">
        <div>
          <span className="k">Open</span>
          <span className={`v ${p.flag}`}>{p.open.length}</span>
        </div>
        <div>
          <span className="k">30 days</span>
          <span className="v">{p.m30.length}</span>
        </div>
        <div>
          <span className="k">On time</span>
          <span className="v">{p.onTime === null ? "–" : p.onTime + "%"}</span>
        </div>
      </div>
      <Sec t="Contact">
        <Pr ic="people" t={c.sender} sub="sends the orders" />
        <Pr ic="mail" t={c.channel} sub="how POs arrive" />
        <Pr ic="clock" t={"Orders " + c.days} sub="usual days" />
      </Sec>
      <Sec t="Delivery">
        <Pr ic="truck" t={c.location} sub={c.slot === "Unspecified" ? "time to confirm each order" : c.slot + " slot"} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 0 2px 28px" }}>
          {c.outlets.map((x) => (
            <span className="tag" key={x}>
              {x}
            </span>
          ))}
        </div>
      </Sec>
      {pr ? (
        <Sec t="Billing">
          <Pr
            ic="inv"
            t={c.terms + " terms"}
            sub={p.lastInv ? `last ${p.lastInv.invoiced} · ${relDay(p.lastInv.date)}` : "no invoices yet"}
            r={p.unInv.length ? `${p.unInv.length} to invoice` : ""}
          />
          {p.m30.length ? <Pr ic="box" t={money(p.billed30)} sub="billed, 30 days" /> : null}
        </Sec>
      ) : null}
      <Sec t="Notes">
        {c.notes.length ? (
          c.notes.map((n, i) => <p key={i}>{n}</p>)
        ) : (
          <p className="hint">None.</p>
        )}
      </Sec>
      <Sec t="History">
        <div>
          {p.all.slice(0, 3).map((x) => (
            <Link className="pr" href={`/orders/${x.id}`} key={x.id}>
              <span className="ic">
                <Icon name={x.source === "whatsapp" ? "chat" : "doc"} />
              </span>
              <span className="t">
                {ref(x)}
                <small>{`${STATE[x.state][1]} · ${x.lines.length} lines`}</small>
              </span>
              <span className="r">{relDay(x.date)}</span>
            </Link>
          ))}
          {p.all.length > 3 ? (
            <Link className="pr" href={`/customers/${c.id}`}>
              <span className="ic">
                <Icon name="chev" />
              </span>
              <span className="t hint">All {p.all.length} orders</span>
            </Link>
          ) : null}
        </div>
      </Sec>
      {pr && p.lastPrice.length ? (
        <Sec t="Last price">
          <div>
            {p.lastPrice.slice(0, 4).map(([k, price, x]) => (
              <Link className="pr" href={`/orders/${x.id}`} key={k}>
                <span className="ic">
                  <Icon name="box" />
                </span>
                <span className="t">
                  {PRODUCTS[k].name}
                  <small>{`${ref(x)} · ${relDay(x.date)}`}</small>
                </span>
                <span className="r">{money(price)}</span>
              </Link>
            ))}
          </div>
        </Sec>
      ) : null}
    </>
  );
}

/** Where the order came from: file, layout, read time, fingerprint. */
export function SourceCard({ o, c }: { o: Order; c: Customer }) {
  return (
    <>
      <div className="psec">
        <div className="ph2">
          Source <Icon name="chev" />
        </div>
        <div className="kv">
          {sourceRows(o, c).map(([k, v]) => (
            <Fragment key={k}>
              <span>{k}</span>
              <span className={k === "Fingerprint" || k === "File" ? "mono" : ""} style={{ wordBreak: "break-all" }}>
                {v}
              </span>
            </Fragment>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          PDF read in the browser · not stored
        </div>
      </div>
      <div style={{ height: 16 }} />
    </>
  );
}
