"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { paletteHits, type PaletteHit } from "@/platform/assistant";
import { meOf, useDemo } from "@/state/demo-store";
import { toggleTheme } from "@/state/theme";
import { useShell } from "./context";

const ICON: Record<PaletteHit["kind"], IconName> = { order: "doc", customer: "building", page: "doc", action: "spark", ask: "spark" };

function label(it: PaletteHit): ReactNode {
  switch (it.kind) {
    case "order":
      return (
        <>
          <b>{it.ref}</b>{` ${it.name}`}
        </>
      );
    case "customer":
      return <b>{it.name}</b>;
    case "page":
      return <b>{it.nav.label}</b>;
    case "action":
      return <b>{it.label}</b>;
    case "ask":
      return <>Ask “{it.text}”</>;
  }
}

/** ⌘K, ported from the prototype's palRender(): orders, customers, pages and a few actions, filtered by what was typed. */
export function Palette({ open }: { open: boolean }) {
  const s = useDemo();
  const u = meOf(s);
  const router = useRouter();
  const shell = useShell();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Every opening starts empty, as openPal(true) does.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setIdx(0);
    }
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const items = paletteHits(s, u, q);
  const cur = Math.max(0, Math.min(idx, items.length - 1));

  const go = (it: PaletteHit) => {
    if (it.kind === "order") router.push(`/orders/${it.id}`);
    else if (it.kind === "customer") router.push(`/customers/${it.id}`);
    else if (it.kind === "page") router.push(it.nav.href);
    else if (it.kind === "ask") shell.openAssistant({ prompt: it.text, send: true });
    else if (it.action === "add") router.push("/add");
    else if (it.action === "ask") shell.openAgent(true);
    else toggleTheme();
  };
  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    shell.openPalette(false);
    go(it);
  };

  let g = "";
  return (
    <div
      className={`pal-bg${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) shell.openPalette(false);
      }}
    >
      <div className="pal" role="dialog" aria-label="Search">
        <input
          ref={input}
          value={q}
          placeholder="Search orders, customers, pages…"
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx(Math.min(items.length - 1, cur + 1));
              requestAnimationFrame(() => list.current?.querySelector(".pi.on")?.scrollIntoView({ block: "nearest" }));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx(Math.max(0, cur - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(cur);
            }
          }}
        />
        <div className="pl" ref={list}>
          {items.length ? (
            items.map((it, i) => {
              const head = it.g !== g ? <div className="ph">{it.g}</div> : null;
              g = it.g;
              return (
                <Fragment key={i}>
                  {head}
                  <div className={`pi${i === cur ? " on" : ""}`} onMouseMove={() => setIdx(i)} onClick={() => run(i)}>
                    <Icon name={it.kind === "page" ? it.nav.icon : ICON[it.kind]} />
                    <span>{label(it)}</span>
                    <small>{it.m}</small>
                  </div>
                </Fragment>
              );
            })
          ) : (
            <div className="empty">Nothing found</div>
          )}
        </div>
        <div className="pf">
          <span>
            <kbd>↑↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
