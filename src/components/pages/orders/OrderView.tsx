"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Lbl, OverdueLbl } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Profile } from "@/components/pages/customers/Profile";
import { NotFound } from "@/components/shell/Guard";
import { Header } from "@/components/shell/Header";
import { SidePane } from "@/components/shell/SidePane";
import { useShell } from "@/components/shell/context";
import { ackTextFor } from "@/lib/ack-text";
import { canDeliver, canEdit, canInvoice, canPrice, lines, seesCustomer, type PricedLine } from "@/platform/access";
import { PRODUCTS } from "@/sample";
import type { Customer, DemoState, Order, ToCheck } from "@/sample";
import {
  addComment,
  approve,
  confirmOrder,
  deliver,
  dismiss,
  DISMISS_REASONS,
  dropDraft,
  fillCell,
  invoice,
  keepOld,
  run,
  sendReply,
  suggest,
  unconfirm,
  viewPrices,
} from "@/state/actions/orders";
import { meOf, subscribe, useDemo } from "@/state/demo-store";
import { evIcon, fmtDay, lc, money, orderTotal, ref, relDay, custOf } from "@/lib/format";
import { SourceCard } from "./SourceCard";
import { activityByDay, orderText, stepsOf, summarise, type Rich } from "./logic";

const RichSpan = ({ r }: { r: Rich }) => (
  <span>
    {r.map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <b key={i}>{p.b}</b>))}
  </span>
);

/** The customer's name with its colour swatch, as the prototype's ctag(). */
const CTag = ({ c }: { c: Customer }) => (
  <span className="tag" style={{ "--c": c.color || "#777" } as CSSProperties}>
    <span className="sw" />
    {c.name}
  </span>
);

const selStyle = { padding: "4px 8px", fontSize: 12 };

function ReviewCard({ t, toast }: { t: ToCheck; toast: (m: string) => void }) {
  const [pick, setPick] = useState("");
  if (t.kind === "revision")
    return (
      <div className="review">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lbl state="needs_check" />
          <b>PO content differs</b>
          <span className="hint">{t.from}</span>
        </div>
        <div className="diff">
          {t.diff.map((d, i) => (
            <Fragment key={i}>
              <span className="hint">{`Line ${d.line + 1} · ${d.outlet} · ${d.field}`}</span>
              <span>
                <del>{d.old}</del> → <ins>{d.new}</ins>
              </span>
            </Fragment>
          ))}
        </div>
        <div className="acts">
          <button className="btn p s" onClick={() => toast(run(approve, t.id))}>
            Approve change
          </button>
          <button className="btn s" onClick={() => toast(run(keepOld, t.id))}>
            Keep {t.diff[0].old}, note it
          </button>
          <select aria-label="Dismiss reason" style={selStyle} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Dismiss, reason…</option>
            {DISMISS_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button className="btn s g" onClick={() => toast(run(dismiss, t.id, pick))}>
            Dismiss
          </button>
        </div>
      </div>
    );
  return (
    <div className="review" style={{ borderLeftColor: "var(--bad)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Lbl state="blocked" />
        <b>{t.text}</b>
      </div>
      <div className="acts">
        <select aria-label="Pick SKU" style={selStyle} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Pick a SKU…</option>
          {Object.keys(PRODUCTS).map((k) => (
            <option key={k} value={k}>
              {k} · {PRODUCTS[k].name}
            </option>
          ))}
        </select>
        <button className="btn p s" onClick={() => toast(run(fillCell, t.id, pick))}>
          Fill and remember
        </button>
      </div>
    </div>
  );
}

function DraftBox({ o, text, toast, copy }: { o: Order; text: string; toast: (m: string) => void; copy: (t: string) => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const wa = o.source === "whatsapp";
  return (
    <div className="draft">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 12.5 }}>Acknowledgement</b>
        <span className="hint">from {o.lines.length} confirmed lines</span>
      </div>
      <textarea ref={ta} aria-label="Draft" defaultValue={text} />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="btn p s"
          onClick={() => {
            if (wa) copy(ta.current?.value ?? text);
            toast(run(sendReply, o.id));
          }}
        >
          {wa ? "Copy for WhatsApp, mark sent" : "Send email"}
        </button>
        <button className="btn s g" onClick={() => run(dropDraft, o.id)}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** One order: header actions, summary, labels, stepper, review, lines, reply, comments, activity, and the customer pane. */
export function OrderView({ id }: { id: string }) {
  const s = useDemo();
  const u = meOf(s);
  const o = s.orders.find((x) => x.id === id);
  const ok = !!o && seesCustomer(u, o.cust);
  const pr = canPrice(u);
  const viewed = s.events.some((e) => e.order === id && e.kind === "price_viewed" && e.actor === u.name);

  // Opening an order with prices is logged once per person.
  useEffect(() => {
    if (ok && pr && !viewed) run(viewPrices, id);
  }, [ok, pr, viewed, id]);

  if (!o || !ok) return <NotFound hint="No such order in your view." />;
  return <OrderPage s={s} o={o} />;
}

function OrderPage({ s, o }: { s: DemoState; o: Order }) {
  const u = meOf(s);
  const shell = useShell();
  const [cmt, setCmt] = useState(false);
  const cmtRef = useRef<HTMLTextAreaElement>(null);
  const c = custOf(s.customers, o.cust);
  const ev = s.events.filter((e) => e.order === o.id);
  const msgs = s.messages.filter((m) => m.order === o.id);
  const cmts = s.comments.filter((x) => x.order === o.id);
  const checks = s.toCheck.filter((t) => t.order === o.id);
  const draft = s.drafts.find((d) => d.order === o.id);
  const pr = canPrice(u);
  const edit = canEdit(u);
  const toast = (m: string) => {
    if (m) shell.toast(m);
  };
  const rows = lines(o, u);

  // The prototype logs "Viewed prices" while it draws the page, so the entry appears from the next
  // redraw on (the next change anywhere), not on the first view. The first change after opening is
  // the log itself.
  const [viewedAtOpen] = useState(() => s.events.some((e) => e.order === o.id && e.kind === "price_viewed" && e.actor === u.name));
  const [showView, setShowView] = useState(viewedAtOpen);
  useEffect(() => {
    if (showView) return;
    let n = 0;
    return subscribe(() => {
      if (++n > 1) setShowView(true);
    });
  }, [showView]);
  const shownEv = showView ? ev : ev.filter((e) => !(e.kind === "price_viewed" && e.actor === u.name));

  useEffect(() => {
    if (cmt) cmtRef.current?.focus();
  }, [cmt]);

  // The order page opens with the customer pane beside it.
  const pane = (
    <SidePane>
      <div className="ph">
        Customer
        <Link className="ib" href={`/customers/${c.id}`} title="Open customer page">
          <Icon name="chev" />
        </Link>
        <button className="ib" title="Hide" onClick={() => shell.setPane("hidden")}>
          <Icon name="x" />
        </button>
      </div>
      <Profile c={c} />
      <SourceCard o={o} c={c} />
    </SidePane>
  );

  return (
    <>
      <Header
        acts={
          <>
            {edit && o.state === "draft" && s.settings.retainsRows ? (
              <button className="btn p s" onClick={() => toast(run(confirmOrder, o.id))}>
                <Icon name="check" />
                Confirm
              </button>
            ) : null}
            {canDeliver(u) && o.state === "confirmed" ? (
              <button className="btn p s" onClick={() => toast(run(deliver, o.id))}>
                <Icon name="truck" />
                Mark delivered
              </button>
            ) : null}
            {canInvoice(u) && o.state === "delivered" && !o.invoiced ? (
              <button className="btn p s" onClick={() => toast(run(invoice, o.id))}>
                <Icon name="inv" />
                Mark invoiced
              </button>
            ) : null}
            <button className="ib" title="Copy lines" onClick={() => shell.copyText(orderText(o, c), "Copied order lines")}>
              <Icon name="copy" />
            </button>
            <button className="ib" title="Download Excel" onClick={() => shell.toast(`Downloaded ${ref(o)}.xlsx`)}>
              <Icon name="dl" />
            </button>
            {edit && ["confirmed", "needs_check"].includes(o.state) ? (
              <button className="ib" title="Unconfirm" onClick={() => toast(run(unconfirm, o.id))}>
                <Icon name="undo" />
              </button>
            ) : null}
            <button className="ib" title="Ask about this order" onClick={() => shell.openAssistant({ orderIds: [o.id] })}>
              <Icon name="spark" />
            </button>
          </>
        }
      >
        <Link className="crumb" href="/orders">
          Orders
        </Link>
        <span className="sep">›</span>
        <span className="mono" style={{ fontSize: 13 }}>
          {ref(o)}
        </span>
      </Header>
      <div className="body">
        <div className="summary">
          <Icon name="spark" />
          <RichSpan r={summarise(o, ev, s.toCheck)} />
        </div>
        <div className="labels">
          <Lbl state={o.state} />
          <OverdueLbl order={o} />
          <CTag c={c} />
          <span className="tag">{o.source === "whatsapp" ? "WhatsApp" : "PDF"}</span>
          <span className="tag">{`${fmtDay(o.date)} · ${c.slot}`}</span>
          {o.exported ? <span className="tag">Exported</span> : null}
          {o.invoiced ? <span className="tag">{o.invoiced}</span> : null}
          <span className="plus" title="Add label">
            +
          </span>
        </div>
        <div className="stepper">
          {stepsOf(o, ev).map((st, i) => (
            <Fragment key={st.label}>
              {i ? <span className="ln" /> : null}
              <span className={`s ${st.cls}`}>
                <i>{st.done ? <Icon name="check" /> : null}</i>
                {st.label}
                {st.small ? (
                  <>
                    {" "}
                    <small>{st.small}</small>
                  </>
                ) : null}
              </span>
            </Fragment>
          ))}
        </div>
        {checks.map((t) => (
          <ReviewCard key={t.id} t={t} toast={toast} />
        ))}
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th>Item</th>
                <th className="n">Qty</th>
                <th>Unit</th>
                <th>Outlet</th>
                {pr ? (
                  <>
                    <th className="n">Unit price</th>
                    <th className="n">Total</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const p = pr ? (l as PricedLine) : null;
                return (
                  <tr key={i}>
                    <td className="num" style={{ color: "var(--ink3)" }}>
                      {i + 1}
                    </td>
                    <td className={`mono ${l.sku ? "" : "red"}`}>{l.sku || "no match"}</td>
                    <td>
                      {l.sku ? PRODUCTS[l.sku].name : l.desc || ""}
                      {l.origin === "manual" ? (
                        <>
                          {" "}
                          <span className="tag">typed</span>
                        </>
                      ) : null}
                    </td>
                    <td className="n">{l.qty}</td>
                    <td>{l.unit}</td>
                    <td>{l.outlet}</td>
                    {p ? (
                      <>
                        <td className="n">{p.unitPrice === null ? "—" : money(p.unitPrice)}</td>
                        <td className="n">{p.total === null ? "—" : money(p.total)}</td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            {pr ? (
              <tfoot>
                <tr>
                  <td colSpan={7} className="n">
                    Total, before GST
                  </td>
                  <td className="n">{money(orderTotal(o))}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {edit || u.role === "account_manager" ? (
            <button className="btn s" onClick={() => run(suggest, o.id, ackTextFor(s, o))}>
              <Icon name="spark" />
              Suggest reply
            </button>
          ) : null}
          <button className="btn s g" onClick={() => shell.openAssistant({ orderIds: [o.id] })}>
            <Icon name="spark" />
            Ask
          </button>
          <button
            className="btn s g"
            onClick={() => {
              setCmt(true);
              cmtRef.current?.focus();
            }}
          >
            <Icon name="chat" />
            Comment
          </button>
        </div>
        {draft ? <DraftBox key={draft.text} o={o} text={draft.text} toast={toast} copy={(t) => navigator.clipboard?.writeText(t).catch(() => {})} /> : null}
        <div className="cmt" id="cmt" hidden={!cmt}>
          <textarea ref={cmtRef} id="cmtT" placeholder="Note for the team on this order…" aria-label="Comment" />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn p s"
              onClick={() => {
                const m = run(addComment, o.id, cmtRef.current?.value ?? "");
                if (!m) return;
                if (cmtRef.current) cmtRef.current.value = "";
                setCmt(false);
                toast(m);
              }}
            >
              Post
            </button>
            <button className="btn s g" onClick={() => setCmt(false)}>
              Cancel
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Activity</h3>
          <div className="log tl">
            {activityByDay(shownEv, pr).map((g) => (
              <Fragment key={g.d}>
                <div className="day">{`${relDay(g.d)} · ${fmtDay(g.d)}`}</div>
                {g.items.map((e, i) => {
                  const m = e.kind === "message_linked" ? msgs.find((x) => x.at === e.at) : null;
                  const cm = e.kind === "comment" ? cmts.find((x) => x.at === e.at) : null;
                  return (
                    <Fragment key={i}>
                      <div className={`ev ${e.actor === u.name ? "me" : ""}`}>
                        <span className="ic">
                          <Icon name={evIcon(e.kind)} />
                        </span>
                        <span className="tx">
                          <b>{e.actor}</b>{` ${lc(e.text)}`}
                        </span>
                        <span className="at">{e.at.slice(11)}</span>
                      </div>
                      {m ? (
                        <div className="msg">
                          <b>{m.from}</b> · {m.source}
                          <br />
                          {m.text}
                        </div>
                      ) : null}
                      {cm ? <div className="msg">{cm.text}</div> : null}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      {pane}
    </>
  );
}
