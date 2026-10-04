"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerMark, Lbl, OverdueLbl } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { summarisePrompt } from "@/platform/assistant";
import { canDeliver, canEdit } from "@/platform/access";
import type { Order } from "@/sample";
import { bulkDeliver, deliver, run } from "@/state/actions/orders";
import { meOf, useDemo } from "@/state/demo-store";
import { ref, relDay, custOf } from "@/lib/format";
import { filterCustomers, groupOrders, mineOf, orderText, searchKey, TABIC, tabsFor, whyText, type Sort } from "./logic";

// The prototype keeps the customer filter and grouping on its in-memory state (S._fc, S._sort):
// they survive moving between pages until a reload.
let keptFc = "";
let keptSort: Sort = "date";

/** Orders: tabs, filters, rows grouped by delivery day, multi-select with the bulk bar, j/k/x/Enter. */
export function OrdersView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const router = useRouter();
  const f = useSearchParams().get("state") || "all";
  const [fc, setFcState] = useState(keptFc);
  const [sort, setSortState] = useState<Sort>(keptSort);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [cur, setCur] = useState(-1);
  const [lastF, setLastF] = useState(f);

  // A new tab is a new render in the prototype, which clears the selection.
  if (lastF !== f) {
    setLastF(f);
    setPicked([]);
  }

  const setFc = (v: string) => {
    keptFc = v;
    setFcState(v);
    setPicked([]);
  };
  const setSort = (v: Sort) => {
    keptSort = v;
    setSortState(v);
    setPicked([]);
  };

  const mine = mineOf(s, u);
  const { tabs, counts } = tabsFor(mine);
  const groups = groupOrders(mine, s.customers, f, fc, sort);
  const custs = filterCustomers(s, u);
  const cust = (o: Order) => custOf(s.customers, o.cust);
  const shown = (o: Order) => searchKey(o, cust(o)).includes(q.toLowerCase());
  const rows = groups.flatMap((g) => g.items).filter(shown);
  const curId = cur >= 0 && cur < rows.length ? rows[cur].id : null;
  const deliverer = canDeliver(u);

  const togglePick = (id: string, on: boolean) => setPicked((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));

  const copyOrder = (o: Order) => shell.copyText(orderText(o, cust(o)), "Copied order lines");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = ((e.target as HTMLElement).tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (!rows.length) return;
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, Math.min(rows.length - 1, cur + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1)));
        setCur(next);
        document.querySelector(`.orow[data-id="${rows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && cur >= 0 && rows[cur]) {
        // Not also the focused link's own Enter (the rail link just clicked keeps focus here,
        // where the prototype's redraw drops it).
        e.preventDefault();
        router.push(`/orders/${rows[cur].id}`);
      }
      else if (e.key === "x" && cur >= 0 && rows[cur]) {
        const id = rows[cur].id;
        togglePick(id, !picked.includes(id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Esc clears the selection (the shell asks before it closes the assistant).
  const { setEscape } = shell;
  useEffect(() => {
    setEscape(() => {
      if (!picked.length) return false;
      setPicked([]);
      return true;
    });
    return () => setEscape(null);
  }, [picked, setEscape]);

  const pickedOrders = picked.map((id) => s.orders.find((o) => o.id === id)).filter((o): o is Order => !!o);
  const canDel = pickedOrders.every((o) => o.state === "confirmed") && deliverer;

  const tabHref = (k: string) => (k === "all" ? "/orders" : `/orders?state=${k}`);

  return (
    <>
      <Header
        icon="list"
        acts={
          <>
            <div className="filt">
              <span className="fw">
                <select value={fc} onChange={(e) => setFc(e.target.value)} aria-label="Customer">
                  <option value="">All customers</option>
                  {custs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevDown" />
              </span>
              <span className="fw">
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Group by">
                  <option value="date">By date</option>
                  <option value="customer">By customer</option>
                  <option value="state">By status</option>
                </select>
                <Icon name="chevDown" />
              </span>
            </div>
            {canEdit(u) ? (
              <Link className="btn p s" href="/add">
                <Icon name="plus" />
                Add
              </Link>
            ) : null}
          </>
        }
      >
        Orders
      </Header>
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <Link key={k} className={`tab ${f === k ? "on" : ""}`} href={tabHref(k)}>
            <Icon name={TABIC[k]} />
            {l}
            <span className="n">{counts[k]}</span>
            {k === "needs_check" && counts[k] ? <span className="d" /> : null}
          </Link>
        ))}
        <span className="sp" />
        <label className="search">
          <Icon name="search" />
          <input id="q" placeholder="Search" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div id="olist" className={picked.length ? "list-mode" : undefined}>
        {groups.length ? (
          groups.map((g) => (
            <div className="grp" key={g.k}>
              <div className="gh">
                <b>{g.k}</b>
                <span>{g.items.length}</span>
              </div>
              {g.items.map((o) => {
                const c = cust(o);
                const on = picked.includes(o.id);
                const cls = ["row", "orow", ["needs_check", "blocked", "draft"].includes(o.state) ? "unread" : "", on ? "picked" : "", curId === o.id ? "cur" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Link className={cls} href={`/orders/${o.id}`} key={o.id} data-id={o.id} data-q={searchKey(o, c)} hidden={!shown(o)}>
                    <input
                      type="checkbox"
                      className="sel"
                      aria-label="Select"
                      checked={on}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => togglePick(o.id, e.target.checked)}
                    />
                    <span className="who">
                      <CustomerMark c={c} />
                      <b>{c.name}</b>
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <Lbl state={o.state} />
                      <OverdueLbl order={o} />
                    </span>
                    <span className="sub">
                      <b>{ref(o)}</b>
                      {whyText(o)}
                    </span>
                    <span className="when">{relDay(o.date)}</span>
                    <span className="hov">
                      {o.state === "confirmed" && deliverer ? (
                        <button
                          className="ib"
                          title="Mark delivered"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // The prototype redraws the list, which clears the selection.
                            setPicked([]);
                            shell.toast(run(deliver, o.id));
                          }}
                        >
                          <Icon name="truck" />
                        </button>
                      ) : null}
                      <button
                        className="ib"
                        title="Copy order lines"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          copyOrder(o);
                        }}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        className="ib"
                        title="Ask about this order"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          shell.openAssistant({ orderIds: [o.id] });
                        }}
                      >
                        <Icon name="spark" />
                      </button>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))
        ) : (
          <div className="empty">No orders here.</div>
        )}
      </div>
      <div id="bulk">
        {picked.length ? (
          <div className="bulk">
            <b>{picked.length} selected</b>
            {canDel ? (
              <button
                className="btn s"
                onClick={() => {
                  const ids = picked;
                  setPicked([]);
                  shell.toast(run(bulkDeliver, ids));
                }}
              >
                <Icon name="truck" />
                Mark delivered
              </button>
            ) : null}
            <button
              className="btn s"
              onClick={() => {
                // As the prototype: the bar and the ticks stay after copying.
                const t = pickedOrders.map((o) => orderText(o, cust(o))).join("\n\n");
                shell.copyText(t, "Copied");
              }}
            >
              <Icon name="copy" />
              Copy lines
            </button>
            <button className="btn s" onClick={() =>
                // The prototype's bulk Ask always prefills "Summarise <refs>"; it never scopes to one order.
                shell.openAssistant(pickedOrders.length > 1 ? { orderIds: pickedOrders.map((o) => o.id) } : { prompt: summarisePrompt(pickedOrders) })
              }>
              <Icon name="spark" />
              Ask
            </button>
            <button className="ib" style={{ color: "inherit" }} onClick={() => setPicked([])} title="Clear">
              <Icon name="x" />
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
