"use client";

/* The customer page, as the prototype's customerView(id): highlights, weekly bars, orders, activity, and the dossier. */
import Link from "next/link";
import { useState } from "react";
import { Lbl, OverdueLbl } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canEdit, canPrice, seesCustomer } from "@/platform/access";
import { addNote } from "@/state/actions/customers";
import { meOf, useDemo } from "@/state/demo-store";
import { evIcon, fmtShort, lc, money, orderTotal, outlets, ref, relDay } from "@/lib/format";
import { ACTIVITY_FILTERS, activity, customerOrders, highlights, type ActivityFilter } from "./figures";
import { Profile } from "./Profile";

export function CustomerView({ id }: { id: string }) {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [flt, setFlt] = useState<ActivityFilter>("all");
  const [note, setNote] = useState("");
  const c = s.customers[id];
  if (!c || !seesCustomer(u, id)) return <Header>Not found</Header>;

  const price = canPrice(u);
  const mine = customerOrders(s, id);
  const hl = highlights(s, id);
  const ev = activity(s, id, flt);
  const byId = (oid: string) => s.orders.find((x) => x.id === oid)!;

  const add = () => {
    if (addNote(id, note)) {
      setNote("");
      shell.toast("Note added");
    }
  };

  return (
    <>
      <Header
        acts={
          <button className="btn s g" onClick={() => shell.openAgent(true, `Catch me up on ${c.name}`)}>
            <Icon name="spark" />
            Ask
          </button>
        }
      >
        <Link className="crumb" href="/customers">
          Customers
        </Link>
        <span className="sep">›</span>
        {c.name}
      </Header>
      <div className="body">
        <div className="two">
          <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
            <div className="hl">
              <div>
                <span className="k">Orders · 30 days</span>
                <span className="v">{hl.orders30}</span>
              </div>
              <div>
                <span className="k">Lines · 30 days</span>
                <span className="v">{hl.lines30}</span>
              </div>
              <div>
                <span className="k">Avg lines / order</span>
                <span className="v">{hl.avgLines}</span>
              </div>
              <div>
                <span className="k">On time</span>
                <span className="v">{hl.onTime === null ? "–" : hl.onTime + "%"}</span>
              </div>
              {price ? (
                <div>
                  <span className="k">Billed · 30 days</span>
                  <span className="v">{money(hl.billed30)}</span>
                </div>
              ) : null}
            </div>
            <div className="card">
              <h3>Orders per week</h3>
              <div className="bars" style={{ marginBottom: 18 }}>
                {hl.weeks.map((w) => (
                  <b key={w.start} className={w.hi ? "hi" : ""} style={{ height: w.height + "%" }} title={w.title}>
                    <span>{w.label}</span>
                  </b>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>
                Orders <span style={{ color: "var(--ink3)" }}>{mine.length}</span>
              </h3>
              {mine.map((o) => (
                <Link
                  className="row"
                  href={`/orders/${o.id}`}
                  key={o.id}
                  style={{ paddingLeft: 0, paddingRight: 0, gridTemplateColumns: "auto minmax(0,1fr) auto" }}
                >
                  <span style={{ display: "flex", gap: 6 }}>
                    <Lbl state={o.state} />
                    <OverdueLbl order={o} />
                  </span>
                  <span className="sub">
                    <b>{ref(o)}</b>
                    {`${o.lines.length} lines · ${outlets(o).join(", ")}${price ? " · " + money(orderTotal(o)) : ""}`}
                  </span>
                  <span className="when">{fmtShort(o.date)}</span>
                </Link>
              ))}
            </div>
            <div className="card">
              <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                Activity
                <span className="seg" style={{ marginLeft: "auto" }}>
                  {ACTIVITY_FILTERS.map(([k, l]) => (
                    <button key={k} className={flt === k ? "on" : ""} onClick={() => setFlt(k)}>
                      {l}
                    </button>
                  ))}
                </span>
              </h3>
              <div className="log tl">
                {ev.length ? (
                  ev.map((e, i) => {
                    const o = byId(e.order);
                    return (
                      <Link className="ev" href={`/orders/${o.id}`} key={i}>
                        <span className="ic">
                          <Icon name={evIcon(e.kind)} />
                        </span>
                        <span className="tx">
                          <b>{e.actor}</b>
                          {` ${lc(e.text)} `}
                          <span className="mono" style={{ color: "var(--ink3)" }}>
                            {ref(o)}
                          </span>
                        </span>
                        <span className="at">{`${relDay(e.at.slice(0, 10))} ${e.at.slice(11)}`}</span>
                      </Link>
                    );
                  })
                ) : (
                  <div className="hint" style={{ padding: "8px 0" }}>
                    Nothing here.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="card" style={{ margin: "0 -20px" }}>
            <Profile c={c} />
            {canEdit(u) ? (
              <div className="psec" style={{ paddingBottom: 14 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    id={`note-${c.id}`}
                    placeholder="Add a standing note"
                    style={{ flex: 1 }}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn s" onClick={add}>
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ height: 12 }} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
