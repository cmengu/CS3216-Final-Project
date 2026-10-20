"use client";

/*
 * The customer dossier, as the prototype's profile(c): logo, name, kind line, Message and Ask,
 * the three mini stats, then Contact, Delivery, Billing, Notes, History and Last price.
 * Used on the customer page; the order page's side pane can use it too.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { useShell } from "@/components/shell/context";
import { canPrice } from "@/platform/access";
import { PRODUCTS } from "@/sample";
import type { Customer } from "@/sample";
import { meOf, useDemo } from "@/state/demo-store";
import { initials, money, ref, relDay, STATE } from "@/lib/format";
import { profileFigures } from "./figures";

const Sec = ({ t, children }: { t: string; children: ReactNode }) => (
  <div className="psec">
    <div className="ph2">
      {`${t} `}
      <Icon name="chev" />
    </div>
    {children}
  </div>
);

const Pr = ({ ic, t, sub, r }: { ic: IconName; t: ReactNode; sub?: ReactNode; r?: ReactNode }) => (
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

/** The customer's big logo mark: its invented SVG on a tint of its colour, or initials. */
export function BigLogo({ c }: { c: Customer }) {
  const style = { "--c": c.color || "#777" } as CSSProperties;
  if (c.logo)
    return (
      <div className="logo big" style={style}>
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: c.logo }} />
      </div>
    );
  return (
    <div className="logo big" style={style}>
      {initials(c.name)}
    </div>
  );
}

export function Profile({ c }: { c: Customer }) {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const price = canPrice(u);
  const f = profileFigures(s, c.id);
  const ask = () => shell.openAssistant({ prompt: `Catch me up on ${c.name}` });

  return (
    <>
      <div className="prof">
        <BigLogo c={c} />
        <h2>
          {c.name}
          <Icon name="check" />
        </h2>
        <div className="sub">
          {`${c.kind || "Customer"} · `}
          <span className="mono">{c.id}</span>
          {` · ${c.channel.replace(/ \(.*\)/, "")}`}
        </div>
        <div className="acts">
          <button
            className="btn"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => shell.copyText(`${c.sender} · ${c.channel}`, "Copied contact")}
          >
            <Icon name="reply" />
            Message
          </button>
          <button className="btn" title={`Ask about ${c.name}`} onClick={ask}>
            <Icon name="spark" />
          </button>
        </div>
      </div>
      <div className="pstats">
        <div>
          <span className="k">Open</span>
          <span className={`v ${f.flag}`}>{f.open}</span>
        </div>
        <div>
          <span className="k">30 days</span>
          <span className="v">{f.m30}</span>
        </div>
        <div>
          <span className="k">On time</span>
          <span className="v">{f.onTime === null ? "–" : f.onTime + "%"}</span>
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
      {price ? (
        <Sec t="Billing">
          <Pr
            ic="inv"
            t={c.terms + " terms"}
            sub={f.lastInv ? `last ${f.lastInv.invoiced} · ${relDay(f.lastInv.date)}` : "no invoices yet"}
            r={f.unInv ? `${f.unInv} to invoice` : ""}
          />
          {f.billed30 !== null ? <Pr ic="box" t={money(f.billed30)} sub="billed, 30 days" /> : null}
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
          {f.mine.slice(0, 3).map((x) => (
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
          {f.mine.length > 3 ? (
            <Link className="pr" href={`/customers/${c.id}`}>
              <span className="ic">
                <Icon name="chev" />
              </span>
              <span className="t hint">{`All ${f.mine.length} orders`}</span>
            </Link>
          ) : null}
        </div>
      </Sec>
      {price && f.lastPrice.length ? (
        <Sec t="Last price">
          <div>
            {f.lastPrice.map(([k, [p, x]]) => (
              <Link className="pr" href={`/orders/${x.id}`} key={k}>
                <span className="ic">
                  <Icon name="box" />
                </span>
                <span className="t">
                  {PRODUCTS[k].name}
                  <small>{`${ref(x)} · ${relDay(x.date)}`}</small>
                </span>
                <span className="r">{money(p)}</span>
              </Link>
            ))}
          </div>
        </Sec>
      ) : null}
    </>
  );
}
