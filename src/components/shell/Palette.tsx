"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { canEdit, navAllowed, seesCustomer, visibleOrders } from "@/platform/access";
import { NAV } from "@/platform/nav";
import { meOf, useDemo } from "@/state/demo-store";
import { toggleTheme } from "@/state/theme";
import { ref, relDay, STATE } from "@/lib/format";
import { useShell } from "./context";

interface Item {
  g: string;
  ic: IconName;
  t: ReactNode;
  m: string;
  go: () => void;
}

/** ⌘K. Orders, customers, pages and a few actions, filtered by what was typed. */
export function Palette({ open }: { open: boolean }) {
  const s = useDemo();
  const u = meOf(s);
  const router = useRouter();
  const shell = useShell();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const close = () => {
    shell.openPalette(false);
    setQ("");
    setIdx(0);
  };

  const k = q.trim().toLowerCase();
  const items: Item[] = [];
  visibleOrders(s.orders, u)
    .filter((o) => !k || (s.customers[o.cust].name + " " + ref(o) + " " + STATE[o.state][1]).toLowerCase().includes(k))
    .slice(0, k ? 8 : 4)
    .forEach((o) =>
      items.push({
        g: "Orders",
        ic: "doc",
        t: (
          <>
            <b>{ref(o)}</b> {s.customers[o.cust].name}
          </>
        ),
        m: `${STATE[o.state][1]} · ${relDay(o.date)}`,
        go: () => router.push(`/orders/${o.id}`),
      }),
    );
  Object.values(s.customers)
    .filter((c) => seesCustomer(u, c.id) && (!k || c.name.toLowerCase().includes(k)))
    .slice(0, k ? 5 : 3)
    .forEach((c) => items.push({ g: "Customers", ic: "building", t: <b>{c.name}</b>, m: c.id, go: () => router.push(`/customers/${c.id}`) }));
  NAV.filter((n) => navAllowed(n.key, u) && (!k || n.label.toLowerCase().includes(k))).forEach((n) =>
    items.push({ g: "Pages", ic: n.icon, t: <b>{n.label}</b>, m: "", go: () => router.push(n.href) }),
  );
  const acts: [string, string, () => void][] = [
    ["Ask the assistant", "⌘I", () => shell.openAgent(true)],
    ["Toggle theme", "", () => toggleTheme()],
  ];
  if (canEdit(u)) acts.unshift(["Add orders", "", () => router.push("/add")]);
  acts.filter(([l]) => !k || l.toLowerCase().includes(k)).forEach(([l, m, f]) => items.push({ g: "Actions", ic: "spark", t: <b>{l}</b>, m, go: f }));
  if (k && !items.length) items.push({ g: "Ask", ic: "spark", t: <>Ask “{q}”</>, m: "", go: () => shell.openAgent(true, q) });

  const cur = Math.max(0, Math.min(idx, items.length - 1));
  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    it.go();
  };

  let g = "";
  return (
    <div
      className={`pal-bg${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
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
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx(Math.max(0, cur - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(cur);
            }
          }}
        />
        <div className="pl">
          {items.length ? (
            items.map((it, i) => {
              const head = it.g !== g ? <div className="ph">{it.g}</div> : null;
              g = it.g;
              return (
                <Fragment key={i}>
                  {head}
                  <div className={`pi${i === cur ? " on" : ""}`} onMouseMove={() => setIdx(i)} onClick={() => run(i)}>
                    <Icon name={it.ic} />
                    <span>{it.t}</span>
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
