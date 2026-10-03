"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Sprout } from "@/components/Sprout";
import { ref } from "@/lib/format";
import { visibleOrders } from "@/platform/access";
import { ask, suggestions, summarisePrompt, type Answer } from "@/platform/assistant";
import { TODAY } from "@/sample";
import { getState, meOf, update, useDemo } from "@/state/demo-store";
import { useShell, type AssistantRequest } from "./context";

/** The prototype's nowStr().slice(11): the time of day, HH:MM. */
const hm = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

interface Pending {
  q: string;
  at: string;
  ctx: string | null;
}

/**
 * The PO assistant column (⌘I), ported from the prototype's renderAgent() and ask(): the empty state
 * with the seedling and suggested questions, "Reading the record…" for a moment, then each answer as
 * the steps taken, the records found and a line or two. Answers come from src/platform/assistant.
 */
export function Agent({ req, onResize }: { req: AssistantRequest & { n: number }; onResize: (w: number, done: boolean) => void }) {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const pathname = usePathname();
  const box = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const self = useRef<HTMLElement>(null);
  const [q, setQ] = useState("");
  const [ctx, setCtx] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [seen, setSeen] = useState(req.n);

  const mine = visibleOrders(s.orders, u);
  const ctxOrder = ctx ? (mine.find((o) => o.id === ctx) ?? null) : null;
  const chat = s.chat as Answer[];
  const [, route, routeId] = pathname.split("/");
  const onOrder = route === "orders" && routeId && mine.some((o) => o.id === routeId) ? routeId : null;

  const send = (text: string) => {
    const raw = text.trim();
    if (!raw || pending) return;
    setQ("");
    setPending({ q: raw, at: hm(), ctx: ctxOrder?.id ?? null });
  };

  // A request from elsewhere (openAssistant): scope, prefill, maybe ask. Adjusted during render, as React recommends.
  if (req.n !== seen) {
    setSeen(req.n);
    const os = (req.orderIds ?? []).map((id) => mine.find((o) => o.id === id)).filter((o) => !!o);
    if (os.length === 1) setCtx(os[0].id);
    const text = req.prompt ?? (os.length > 1 ? summarisePrompt(os) : "");
    if (text && req.send) send(text);
    else if (text) setQ(text);
  }

  useEffect(() => {
    if (!shell.agentOpen) return;
    const t = setTimeout(() => box.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [shell.agentOpen, req.n]);

  // "Reading the record…" for 900 ms, then the answer, as in the prototype.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      const st = getState();
      const me = meOf(st);
      const a = ask(st, me, pending.q, { orderId: pending.ctx, key: "a" + (st.seq + 1), at: pending.at });
      update((d) => {
        d.seq += 1;
        d.chat.push(a);
        if (pending.ctx) {
          const at = TODAY + " " + hm();
          const text = `Asked “${pending.q}”`;
          d.events.push({ order: pending.ctx, at, kind: "asked", actor: me.name, text });
          d.history.push({ at, who: me.name, kind: "asked", order: pending.ctx, text });
        }
      });
      setPending(null);
    }, 900);
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [chat.length, pending]);

  const thumb = (key: string, v: 1 | -1) =>
    update((d) => {
      const a = (d.chat as Answer[]).find((x) => x.key === key);
      if (a) a.thumb = a.thumb === v ? 0 : v;
    });

  const ask1 = (u: { q: string; at: string }) => (
    <div className="u">
      <small>Today at {u.at}</small>
      {u.q}
    </div>
  );

  return (
    <aside className="agent" id="agent" role="complementary" aria-label="PO assistant" ref={self}>
      <div
        className="rz"
        title="Drag to resize"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: self.current?.offsetWidth ?? 400 };
          e.currentTarget.classList.add("on");
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onResize(Math.max(320, Math.min(640, drag.current.w + (e.clientX - drag.current.x))), false);
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          e.currentTarget.classList.remove("on");
          onResize(self.current?.offsetWidth ?? 400, true);
        }}
        onPointerCancel={(e) => {
          if (!drag.current) return;
          drag.current = null;
          e.currentTarget.classList.remove("on");
          onResize(self.current?.offsetWidth ?? 400, true);
        }}
      />
      <div className="ah">
        <span className="ttl">
          <Icon name="spark" />
          PO assistant <small>as {u.name}</small>
        </span>
        <span className="sp" />
        <button
          className="ib"
          title="New conversation"
          onClick={() =>
            update((d) => {
              d.chat = [];
            })
          }
        >
          <Icon name="plus" />
        </button>
        <button className="ib" title="Close (Esc)" onClick={() => shell.openAgent(false)}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ab" ref={body}>
        {!chat.length && !pending ? (
          <>
            <div className="emptyst">
              <Sprout />
              <h4>PO assistant</h4>
            </div>
            <div className="qa">
              {suggestions(ctxOrder).map((t) => (
                <button key={t} onClick={() => send(t)}>
                  <Icon name="spark" />
                  {t}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {chat.map((a) => (
              <div className="turn" key={a.key}>
                {ask1(a)}
                <div className="steps">
                  {a.steps.map((st, i) => (
                    <details key={i}>
                      <summary>
                        <Icon name="chev" />
                        {st.label}
                        <span className="ms">
                          {st.rows} · {st.ms} ms
                        </span>
                      </summary>
                      <div className="d">
                        {st.tool}({st.params})
                      </div>
                    </details>
                  ))}
                </div>
                {a.records.length ? (
                  <div className="recs">
                    {a.records.map((r, i) => (
                      <Link className="rec" href={`/orders/${r.id}`} key={i}>
                        <span>{r.text}</span>
                        <small>{r.meta}</small>
                      </Link>
                    ))}
                  </div>
                ) : null}
                <div className="ans">{a.prose}</div>
                <div className="worked">
                  <span>
                    {`Worked for ${a.total}s · ${a.checked}`}
                  </span>
                  <span className="thumbs">
                    <button onClick={() => thumb(a.key, 1)} className={a.thumb === 1 ? "on" : ""} aria-label="Helpful">
                      👍
                    </button>
                    <button onClick={() => thumb(a.key, -1)} className={a.thumb === -1 ? "on" : ""} aria-label="Not helpful">
                      👎
                    </button>
                  </span>
                </div>
              </div>
            ))}
            {pending ? (
              <div className="turn">
                {ask1(pending)}
                <div className="thinking">
                  <Sprout small />
                  <span>Reading the record…</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <form
        className="af"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <div className="box">
          <div className="ctx">
            {ctxOrder ? (
              <span className="tag">
                <Icon name="doc" />
                {ref(ctxOrder)} · {s.customers[ctxOrder.cust].name}
                <button type="button" onClick={() => setCtx(null)} aria-label="Remove context" style={{ marginLeft: 2, color: "var(--ink3)" }}>
                  ×
                </button>
              </span>
            ) : null}
          </div>
          <textarea
            ref={box}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about orders, customers or what changed…"
            rows={1}
            aria-label="Ask"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(q);
              }
            }}
          />
          <div className="ar">
            <button type="button" className="ib" title="Add the open order as context" hidden={!(onOrder && ctx !== onOrder)} onClick={() => onOrder && setCtx(onOrder)}>
              <Icon name="plus" />
            </button>
            <span className="sp" />
            <label className="model">
              <Icon name="spark" style={{ width: 12, height: 12 }} />
              <select aria-label="Model" defaultValue="Auto">
                <option>Auto</option>
                <option>Fast</option>
                <option>Careful</option>
              </select>
            </label>
            <button type="submit" className="send" title="Send">
              <Icon name="arrowUp" />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
