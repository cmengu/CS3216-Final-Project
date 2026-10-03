"use client";

/* Settings › Replies (prototype: repliesView): the opening line, what the reply includes, and a live preview. */
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { ReplyOptions } from "@/sample";
import { useDemo, update } from "@/state/demo-store";
import { setReplyStyle, toggleReply } from "@/state/actions/settings";
import { ackTextFor, replyOpt } from "@/lib/ack-text";
import { ref } from "@/lib/format";

/** The previewed order, kept for the session as the prototype keeps S._rs. */
let keptRs = "o1";

export function RepliesPane() {
  const s = useDemo();
  const r = replyOpt(s.settings);
  const [rs, setRsState] = useState(keptRs);
  const setRs = (v: string) => {
    keptRs = v;
    setRsState(v);
  };
  const so = s.orders.find((o) => o.id === rs) || s.orders[0];
  const wa = so.source === "whatsapp";

  const tg = (k: keyof ReplyOptions, l: string, d: string) => (
    <div className="opt">
      <span>
        <b>{l}</b>
        <small>{d}</small>
      </span>
      <button className={`tgl ${r[k] ? "on" : ""}`} role="switch" aria-checked={!!r[k]} aria-label={l} onClick={() => update((x) => toggleReply(x, k))} />
    </div>
  );

  return (
    <div className="rgrid">
      <div className="clist">
        <div className="citem">
          <label className="fl">
            Opening line
            <textarea id="rstyle" rows={2} value={s.settings.style} onChange={(e) => update((x) => setReplyStyle(x, e.target.value))} />
          </label>
        </div>
        <div className="citem">
          {tg("date", "Delivery day and session", "Thu, 1 Oct · AM")}
          {tg("lines", "List every item", "Name, quantity and outlet")}
          {tg("sign", "Sign with the sender", "The person who taps send")}
        </div>
        <div className="citem">
          <div className="opt">
            <span>
              <b>PDF orders</b>
              <small>Sent by email from the orders mailbox</small>
            </span>
            <span className="lbl">
              <Icon name="mail" />
              Email
            </span>
          </div>
          <div className="opt">
            <span>
              <b>WhatsApp orders</b>
              <small>Copied, then pasted into the chat</small>
            </span>
            <span className="lbl">
              <Icon name="copy" />
              Copy
            </span>
          </div>
        </div>
      </div>
      <div className="rprev">
        <div className="rhead">
          <span>Preview</span>
          <select value={so.id} onChange={(e) => setRs(e.target.value)}>
            {s.orders
              .filter((o) => o.state !== "draft")
              .slice(0, 5)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {s.customers[o.cust].name} · {ref(o)}
                </option>
              ))}
          </select>
        </div>
        <div className={`bubble ${wa ? "wa" : ""}`}>
          <pre id="rprev">{ackTextFor(s, so)}</pre>
        </div>
        <div className="hint">{wa ? "Copied for WhatsApp" : "Sent by email"} · only after a person taps send</div>
      </div>
    </div>
  );
}
