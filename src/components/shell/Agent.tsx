"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { Sprout } from "@/components/Sprout";
import { useMe } from "@/state/demo-store";
import { useShell } from "./context";

const QUESTIONS = ["What needs me today?", "What is still open for Marina Grand?", "What goes out tomorrow?", "Catch me up on Harbour Hotel"];

/**
 * The PO assistant column (⌘I). Visual shell only for now: header, empty state with the seedling,
 * suggested questions and the composer. Answering comes in a later task.
 */
export function Agent({ prefill, onResize }: { prefill: string; onResize: (w: number, done: boolean) => void }) {
  const u = useMe();
  const shell = useShell();
  const q = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const self = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!shell.agentOpen) return;
    if (q.current && prefill) q.current.value = prefill;
    const t = setTimeout(() => q.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [shell.agentOpen, prefill]);

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
          drag.current = null;
          e.currentTarget.classList.remove("on");
        }}
      />
      <div className="ah">
        <span className="ttl">
          <Icon name="spark" />
          PO assistant <small>as {u.name}</small>
        </span>
        <span className="sp" />
        <button className="ib" title="New conversation">
          <Icon name="plus" />
        </button>
        <button className="ib" title="Close (Esc)" onClick={() => shell.openAgent(false)}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ab">
        <div className="emptyst">
          <Sprout />
          <h4>PO assistant</h4>
        </div>
        <div className="qa">
          {QUESTIONS.map((t) => (
            <button
              key={t}
              onClick={() => {
                if (q.current) {
                  q.current.value = t;
                  q.current.focus();
                }
              }}
            >
              <Icon name="spark" />
              {t}
            </button>
          ))}
        </div>
      </div>
      <form className="af" onSubmit={(e) => e.preventDefault()}>
        <div className="box">
          <div className="ctx" />
          <textarea
            ref={q}
            placeholder="Ask about orders, customers or what changed…"
            rows={1}
            aria-label="Ask"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
            }}
          />
          <div className="ar">
            <button type="button" className="ib" title="Add the open order as context" hidden>
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
