"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OverdueLbl } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canDeliver, canEdit, canPrice } from "@/platform/access";
import { PRODUCTS, TODAY, type Order, type ToCheck } from "@/sample";
import {
  approve,
  bulkDeliver,
  confirmOrder,
  deliver,
  dismiss,
  DISMISS_REASONS,
  fillCell,
  keepOld,
  run,
} from "@/state/actions/orders";
import { meOf, useDemo } from "@/state/demo-store";
import { custOf, fmtDay, money, orderTotal, outlets, ref, relDay, slotText, STATE } from "@/lib/format";
import { filterCustomers, groupOrders, mineOf, orderText, searchKey, TABIC, tabsFor, whyText, type Sort } from "./logic";

// The prototype keeps the customer filter and grouping on its in-memory state (S._fc, S._sort):
// they survive moving between pages until a reload.
let keptFc = "";
let keptSort: Sort = "date";

type DutyMode = "ledger" | "exceptions" | "dispatch";

const MODE_CAPTIONS: Record<DutyMode, string> = {
  ledger: "Mode: Read-only monitoring",
  exceptions: "Duty: Sales & Coordinator (Exceptions)",
  dispatch: "Duty: Warehouse & Packing (Dispatch)",
};

/** Single-line details text for the ledger table (without line counts). */
function detailText(o: Order, toCheck: ReturnType<typeof useDemo>["toCheck"]): string {
  if (o.state === "needs_check" || o.state === "blocked") {
    return whyText(o, toCheck);
  }
  return outlets(o).join(", ");
}

/**
 * Orders: 3-Mode Separation of Duty
 * 1. Order Ledger (Read-only monitoring, no inline action buttons or checkboxes)
 * 2. Resolve Exceptions Workbench (Sales / Coordinator duty for PO revisions & unmapped SKUs)
 * 3. Dispatch Queue (Warehouse / Packing duty for confirmed orders ready to deliver)
 */
export function OrdersView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const router = useRouter();
  const f = useSearchParams().get("state") || "all";
  const [mode, setMode] = useState<DutyMode>("ledger");
  const [fc, setFcState] = useState(keptFc);
  const [sort, setSortState] = useState<Sort>(keptSort);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [cur, setCur] = useState(-1);
  const [excId, setExcId] = useState<string | null>(null);
  const [lastF, setLastF] = useState(f);

  const editor = canEdit(u);
  const deliverer = canDeliver(u);
  const showPrice = canPrice(u);

  // Ensure active mode is valid for the current user's role permissions.
  const activeMode: DutyMode =
    mode === "exceptions" && !editor ? "ledger" : mode === "dispatch" && !deliverer ? "ledger" : mode;

  if (lastF !== f) {
    setLastF(f);
    setPicked([]);
    setCur(-1);
  }

  const switchMode = (next: DutyMode) => {
    setMode(next);
    setCur(-1);
    if (next !== "dispatch") setPicked([]);
  };

  const setFc = (v: string) => {
    keptFc = v;
    setFcState(v);
    setPicked([]);
    setCur(-1);
  };
  const setSort = (v: Sort) => {
    keptSort = v;
    setSortState(v);
    setPicked([]);
    setCur(-1);
  };

  const mine = mineOf(s, u);
  const { tabs, counts } = tabsFor(mine);
  const groups = groupOrders(mine, s.customers, f, fc, sort, q);
  const dispatchGroups = groupOrders(mine, s.customers, "confirmed", fc, "date", "");
  const custs = filterCustomers(s, u);
  const cust = (o: Order) => custOf(s.customers, o.cust);

  const exceptionOrders = mine.filter((o) => o.state === "needs_check" || o.state === "blocked");
  const dispatchOrders = dispatchGroups.flatMap((g) => g.items);

  const activeRows = activeMode === "dispatch" ? dispatchOrders : activeMode === "ledger" ? groups.flatMap((g) => g.items) : [];
  const curId = cur >= 0 && cur < activeRows.length ? activeRows[cur].id : null;

  const revCount = mine.filter((o) => o.state === "needs_check").length;
  const blkCount = mine.filter((o) => o.state === "blocked").length;
  const breakdownParts: string[] = [];
  if (revCount) breakdownParts.push(`${revCount} PO ${revCount === 1 ? "revision" : "revisions"}`);
  if (blkCount) breakdownParts.push(`${blkCount} unmapped ${blkCount === 1 ? "SKU" : "SKUs"}`);

  const activeExcOrder =
    exceptionOrders.find((o) => o.id === excId) ?? exceptionOrders[0] ?? null;

  const togglePick = (id: string, on: boolean) =>
    setPicked((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));
  const allDispatchPicked = dispatchOrders.length > 0 && dispatchOrders.every((r) => picked.includes(r.id));
  const toggleAllDispatch = (on: boolean) => setPicked(on ? dispatchOrders.map((r) => r.id) : []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (!activeRows.length) return;
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(
          0,
          Math.min(activeRows.length - 1, cur + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1)),
        );
        setCur(next);
        document.querySelector(`.orow[data-id="${activeRows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && cur >= 0 && activeRows[cur]) {
        if (target?.closest?.("button, a, input, textarea, select, [role='button']")) return;
        e.preventDefault();
        router.push(`/orders/${activeRows[cur].id}`);
      } else if (e.key === "x" && activeMode === "dispatch" && cur >= 0 && activeRows[cur]) {
        const id = activeRows[cur].id;
        togglePick(id, !picked.includes(id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Esc clears the dispatch selection (the shell asks before it closes the assistant).
  const { setEscape } = shell;
  useEffect(() => {
    setEscape(() => {
      if (!picked.length) return false;
      setPicked([]);
      return true;
    });
    return () => setEscape(null);
  }, [picked, setEscape]);

  const pickedDispatchOrders = picked
    .map((id) => dispatchOrders.find((o) => o.id === id))
    .filter((o): o is Order => !!o);

  const tabHref = (k: string) => (k === "all" ? "/orders" : `/orders?state=${k}`);
  const ledgerColSpan = showPrice ? 7 : 6;

  return (
    <>
      <Header
        className="o-hd"
        acts={
          <div className="filt">
            <span className="o-role-hint">{MODE_CAPTIONS[activeMode]}</span>
            {activeMode === "ledger" ? (
              <>
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
              </>
            ) : null}
          </div>
        }
      >
        <div className="o-duty-switch" role="tablist" aria-label="Order workspace mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "ledger"}
            className={`o-duty-btn mode-ledger${activeMode === "ledger" ? " on" : ""}`}
            onClick={() => switchMode("ledger")}
          >
            Order Ledger
            <span className="cnt">{mine.length}</span>
          </button>
          {editor ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "exceptions"}
              className={`o-duty-btn mode-exceptions${activeMode === "exceptions" ? " on" : ""}`}
              onClick={() => switchMode("exceptions")}
            >
              <span className="o-duty-dot warn" />
              Resolve Exceptions
              <span className={`cnt${exceptionOrders.length ? " warn" : ""}`}>{exceptionOrders.length}</span>
            </button>
          ) : null}
          {deliverer ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "dispatch"}
              className={`o-duty-btn mode-dispatch${activeMode === "dispatch" ? " on" : ""}`}
              onClick={() => switchMode("dispatch")}
            >
              <span className="o-duty-dot good" />
              Dispatch Queue
              <span className={`cnt${dispatchOrders.length ? " info" : ""}`}>{dispatchOrders.length}</span>
            </button>
          ) : null}
        </div>
      </Header>

      {/* ====================================================================
          MODE 1: READ-ONLY ORDER LEDGER (No inline action buttons, no checkboxes)
          ==================================================================== */}
      {activeMode === "ledger" ? (
        <>
          {(editor && exceptionOrders.length > 0) || (deliverer && dispatchOrders.length > 0) ? (
            <div className="o-notice" role="region" aria-label="Operational duty notice">
              {exceptionOrders.length > 0 ? (
                <>
                  <span className="o-notice-dot" />
                  <span>
                    <b>
                      {exceptionOrders.length}{" "}
                      {exceptionOrders.length === 1 ? "order requires" : "orders require"} exception review
                    </b>{" "}
                    before packing
                  </span>
                  {breakdownParts.length > 0 ? (
                    <>
                      <span className="o-notice-sep">·</span>
                      <span className="o-notice-detail">{breakdownParts.join(", ")}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="o-notice-dot good" />
                  <span>
                    <b>
                      {dispatchOrders.length} confirmed {dispatchOrders.length === 1 ? "order" : "orders"}
                    </b>{" "}
                    cleared for warehouse dispatch
                  </span>
                </>
              )}
              <div className="o-notice-acts">
                {editor && exceptionOrders.length > 0 ? (
                  <button
                    type="button"
                    className="o-link-btn primary"
                    onClick={() => switchMode("exceptions")}
                  >
                    Enter Exception Review ({exceptionOrders.length}) →
                  </button>
                ) : null}
                {deliverer && dispatchOrders.length > 0 ? (
                  <button
                    type="button"
                    className={`o-link-btn${!editor || exceptionOrders.length === 0 ? " primary" : ""}`}
                    onClick={() => switchMode("dispatch")}
                  >
                    Open Dispatch Queue ({dispatchOrders.length}) →
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

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
              <input
                id="q"
                placeholder="Filter by PO, customer…"
                aria-label="Search orders"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCur(-1);
                }}
              />
            </label>
          </div>

          <div id="olist">
            {groups.length ? (
              <div className="o-ledger-wrap scroll">
                <table className="tbl o-ledger">
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Customer</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Details</th>
                      {showPrice ? <th className="n">Total</th> : null}
                      <th className="n">Delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <LedgerGroup
                        key={g.k}
                        group={g}
                        colSpan={ledgerColSpan}
                        cust={cust}
                        curId={curId}
                        showPrice={showPrice}
                        toCheck={s.toCheck}
                        onOpen={(id) => router.push(`/orders/${id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">{q.trim() ? `No orders matching "${q.trim()}".` : "No orders here."}</div>
            )}
          </div>
        </>
      ) : null}

      {/* ====================================================================
          MODE 2: RESOLVE EXCEPTIONS WORKBENCH (Sales / Coordinator Duty)
          ==================================================================== */}
      {activeMode === "exceptions" ? (
        <div className="o-wb">
          <div className="o-wb-rail">
            <div className="o-wb-rail-hd">
              <span>Exception Queue</span>
              <span className="mono">{exceptionOrders.length} pending</span>
            </div>
            {exceptionOrders.map((o) => {
              const c = cust(o);
              const isAct = activeExcOrder?.id === o.id;
              return (
                <button
                  type="button"
                  key={o.id}
                  className={`o-wb-item${isAct ? " active" : ""}`}
                  onClick={() => setExcId(o.id)}
                >
                  <div className="o-wb-item-top">
                    <span className="o-cust">{c.name}</span>
                    <span className="o-po mono">{ref(o)}</span>
                  </div>
                  <div>
                    <span className={`o-st st-${o.state}`}>
                      <i />
                      {o.state === "needs_check" ? "Needs check · PO revision" : "Blocked · Unmapped SKU"}
                    </span>
                  </div>
                  <div className="o-wb-item-sub">
                    Deliver {relDay(o.date)} · {outlets(o).join(", ")}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="o-wb-stage">
            {activeExcOrder ? (
              <ExceptionStage
                key={activeExcOrder.id}
                order={activeExcOrder}
                customer={cust(activeExcOrder)}
                toCheck={s.toCheck.filter((t) => t.order === activeExcOrder.id)}
                showPrice={showPrice}
                toast={(m) => shell.toast(m)}
              />
            ) : (
              <div className="empty" style={{ textAlign: "left", padding: "16px 0" }}>
                <p style={{ margin: "0 0 12px", color: "var(--ink)", fontWeight: 500 }}>
                  All exceptions resolved — no orders awaiting coordinator review.
                </p>
                <button type="button" className="btn" onClick={() => switchMode("ledger")}>
                  Return to Order Ledger
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ====================================================================
          MODE 3: DISPATCH QUEUE (Warehouse / Packing Duty)
          ==================================================================== */}
      {activeMode === "dispatch" ? (
        <>
          <div className="o-dispatch-bar">
            <span>
              <b>Warehouse Dispatch Mode</b> — Showing only <b>Confirmed</b> orders cleared for packing and delivery
            </span>
            <div className="o-dispatch-acts">
              <button
                type="button"
                className="btn s"
                disabled={!pickedDispatchOrders.length}
                onClick={() => {
                  const t = pickedDispatchOrders.map((o) => orderText(o, cust(o))).join("\n\n");
                  shell.copyText(t, "Copied");
                }}
              >
                <Icon name="copy" />
                Copy lines ({pickedDispatchOrders.length})
              </button>
              <button
                type="button"
                className="btn p s"
                disabled={!pickedDispatchOrders.length}
                onClick={() => {
                  const ids = pickedDispatchOrders.map((o) => o.id);
                  setPicked([]);
                  shell.toast(run(bulkDeliver, ids));
                }}
              >
                <Icon name="truck" />
                Mark selected delivered ({pickedDispatchOrders.length})
              </button>
            </div>
          </div>

          <div id="olist">
            {dispatchGroups.length ? (
              <div className="o-ledger-wrap scroll">
                <table className="tbl o-ledger">
                  <thead>
                    <tr>
                      <th className="o-col-chk">
                        <input
                          type="checkbox"
                          className="sel"
                          aria-label="Select all confirmed orders"
                          checked={allDispatchPicked}
                          onChange={(e) => toggleAllDispatch(e.target.checked)}
                        />
                      </th>
                      <th>PO #</th>
                      <th>Customer</th>
                      <th>Slot</th>
                      <th>Outlets</th>
                      <th className="n">Delivery</th>
                      <th className="o-col-act">Fulfillment Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchGroups.map((g) => (
                      <DispatchGroup
                        key={g.k}
                        group={g}
                        cust={cust}
                        picked={picked}
                        curId={curId}
                        togglePick={togglePick}
                        onOpen={(id) => router.push(`/orders/${id}`)}
                        onDeliver={(id) => {
                          setPicked((p) => p.filter((x) => x !== id));
                          shell.toast(run(deliver, id));
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">No confirmed orders awaiting dispatch.</div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

interface LedgerGroupProps {
  group: ReturnType<typeof groupOrders>[number];
  colSpan: number;
  cust: (o: Order) => ReturnType<typeof custOf>;
  curId: string | null;
  showPrice: boolean;
  toCheck: ReturnType<typeof useDemo>["toCheck"];
  onOpen: (id: string) => void;
}

function LedgerGroup({ group, colSpan, cust, curId, showPrice, toCheck, onOpen }: LedgerGroupProps) {
  return (
    <>
      <tr className="o-sec-row">
        <td colSpan={colSpan}>
          <span>{group.k}</span> · {group.items.length} {group.items.length === 1 ? "order" : "orders"}
        </td>
      </tr>
      {group.items.map((o) => {
        const c = cust(o);
        const cls = ["orow", curId === o.id ? "cur" : ""].filter(Boolean).join(" ");
        const isToday = o.date === TODAY;
        return (
          <tr
            className={cls}
            key={o.id}
            data-id={o.id}
            data-q={searchKey(o, c)}
            onClick={(e) => {
              const t = e.target as HTMLElement | null;
              if (t?.closest("a, button, input, label")) return;
              onOpen(o.id);
            }}
          >
            <td className="o-po mono">
              <Link href={`/orders/${o.id}`}>{ref(o)}</Link>
            </td>
            <td className="o-cust">
              <Link href={`/orders/${o.id}`}>{c.name}</Link>
            </td>
            <td className="o-chan">{o.source === "pdf" ? "PDF" : "WhatsApp"}</td>
            <td>
              <span className="o-status-cell">
                <span className={`o-st st-${o.state}`}>
                  <i />
                  {STATE[o.state][1]}
                </span>
                <OverdueLbl order={o} />
              </span>
            </td>
            <td className="o-note">{detailText(o, toCheck)}</td>
            {showPrice ? <td className="n mono">{money(orderTotal(o))}</td> : null}
            <td className={`n o-date${isToday ? " due" : ""}`}>{relDay(o.date)}</td>
          </tr>
        );
      })}
    </>
  );
}

interface ExceptionStageProps {
  order: Order;
  customer: ReturnType<typeof custOf>;
  toCheck: ToCheck[];
  showPrice: boolean;
  toast: (m: string) => void;
}

function ExceptionStage({ order, customer, toCheck, showPrice, toast }: ExceptionStageProps) {
  const chanLabel = order.source === "pdf" ? "PDF" : "WhatsApp";
  const receivedLabel = order.file?.at ? `received ${order.file.at}` : "received";
  return (
    <>
      <div className="o-wb-stage-hd">
        <div>
          <h2>
            {customer.name} ·{" "}
            <span className="mono" style={{ fontSize: 16 }}>
              {ref(order)}
            </span>
          </h2>
          <div className="o-wb-stage-meta">
            {chanLabel} {receivedLabel} · Delivery {fmtDay(order.date)} ({slotText(customer)})
            {showPrice ? ` · Total ${money(orderTotal(order))}` : ""}
          </div>
        </div>
        <Link className="o-link-btn" href={`/orders/${order.id}`}>
          Open full order dossier →
        </Link>
      </div>

      {toCheck.length > 0 ? (
        toCheck.map((t) => (
          <ExceptionResolutionBox
            key={t.id}
            order={order}
            item={t}
            showPrice={showPrice}
            toast={toast}
          />
        ))
      ) : (
        <div className="o-wb-box">
          <div className="o-wb-box-title">
            <span>{order.state === "needs_check" ? "Order awaiting confirmation" : "Order blocked"}</span>
          </div>
          <div>Review the order lines and confirm when ready for packing:</div>
          <div className="o-wb-actions">
            {order.state === "needs_check" ? (
              <button type="button" className="btn p" onClick={() => toast(run(confirmOrder, order.id))}>
                Confirm order
              </button>
            ) : null}
            <Link className="btn" href={`/orders/${order.id}`}>
              Inspect full order →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

function ExceptionResolutionBox({
  order,
  item,
  showPrice,
  toast,
}: {
  order: Order;
  item: ToCheck;
  showPrice: boolean;
  toast: (m: string) => void;
}) {
  const [pick, setPick] = useState("");

  if (item.kind === "revision") {
    return (
      <div className="o-wb-box">
        <div className="o-wb-box-title">
          <span>PO Revision Detected</span>
          <span className="mono" style={{ textTransform: "none", fontWeight: 400, color: "var(--ink2)" }}>
            {item.from}
          </span>
        </div>
        <div>
          Customer sent an updated PO changing order values. Confirm whether to update the order before packing:
        </div>
        <table className="o-diff-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Item</th>
              <th>Outlet</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {item.diff.map((d, idx) => {
              const line = order.lines[d.line];
              const prodName = line?.sku && PRODUCTS[line.sku] ? PRODUCTS[line.sku].name : line?.desc || "Item";
              return (
                <tr key={idx}>
                  <td className="mono">{d.line + 1}</td>
                  <td>
                    <b>{prodName}</b>{" "}
                    {line?.sku ? (
                      <span className="mono" style={{ color: "var(--ink3)", fontSize: 11.5 }}>
                        {line.sku}
                      </span>
                    ) : null}
                  </td>
                  <td>{d.outlet}</td>
                  <td>
                    <span className="o-diff-old">{d.old}</span> → <span className="o-diff-new">{d.new}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="o-wb-actions">
          <button type="button" className="btn p s" onClick={() => toast(run(approve, item.id))}>
            Approve revision &amp; next →
          </button>
          <button type="button" className="btn s" onClick={() => toast(run(keepOld, item.id))}>
            Keep {item.diff[0]?.old ?? "original"}, note it
          </button>
          <select
            aria-label="Dismiss reason"
            className="o-sku-select"
            style={{ minWidth: 170 }}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Dismiss, reason…</option>
            {DISMISS_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn s g"
            disabled={!pick}
            onClick={() => toast(run(dismiss, item.id, pick))}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const missingLines = order.lines
    .map((l, idx) => ({ line: l, idx }))
    .filter(({ line }) => !line.sku);

  return (
    <div className="o-wb-box bad">
      <div className="o-wb-box-title">
        <span>Unmapped SKU · Blocked</span>
      </div>
      <div>{item.text}. Map it to a catalog SKU to unblock export and packing:</div>
      <table className="o-diff-table">
        <thead>
          <tr>
            <th>Line</th>
            <th>PO Wording</th>
            <th>Qty</th>
            <th>Assign Catalog SKU</th>
          </tr>
        </thead>
        <tbody>
          {(missingLines.length ? missingLines : [{ line: order.lines[0], idx: 0 }]).map(({ line, idx }) => (
            <tr key={idx}>
              <td className="mono">{idx + 1}</td>
              <td>
                <b>&ldquo;{line?.desc || item.text}&rdquo;</b>
              </td>
              <td className="mono">{line ? `${line.qty} ${line.unit}` : "—"}</td>
              <td>
                <select
                  aria-label="Pick SKU"
                  className="o-sku-select"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                >
                  <option value="">Choose a product…</option>
                  {Object.keys(PRODUCTS).map((k) => (
                    <option key={k} value={k}>
                      {k} · {PRODUCTS[k].name}
                      {showPrice ? ` (${money(PRODUCTS[k].price)})` : ""}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="o-wb-actions">
        <button
          type="button"
          className="btn p s"
          disabled={!pick}
          onClick={() => toast(run(fillCell, item.id, pick))}
        >
          Fill and remember alias →
        </button>
      </div>
    </div>
  );
}

interface DispatchGroupProps {
  group: ReturnType<typeof groupOrders>[number];
  cust: (o: Order) => ReturnType<typeof custOf>;
  picked: string[];
  curId: string | null;
  togglePick: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  onDeliver: (id: string) => void;
}

function DispatchGroup({ group, cust, picked, curId, togglePick, onOpen, onDeliver }: DispatchGroupProps) {
  return (
    <>
      <tr className="o-sec-row">
        <td colSpan={7}>
          <span>Due {group.k}</span> · {group.items.length} {group.items.length === 1 ? "order" : "orders"} ready
        </td>
      </tr>
      {group.items.map((o) => {
        const c = cust(o);
        const on = picked.includes(o.id);
        const cls = ["orow", on ? "picked" : "", curId === o.id ? "cur" : ""].filter(Boolean).join(" ");
        const isToday = o.date === TODAY;
        return (
          <tr
            className={cls}
            key={o.id}
            data-id={o.id}
            onClick={(e) => {
              const t = e.target as HTMLElement | null;
              if (t?.closest("a, button, input, label")) return;
              onOpen(o.id);
            }}
          >
            <td className="o-col-chk">
              <input
                type="checkbox"
                className="sel"
                aria-label={`Select ${c.name} ${ref(o)}`}
                checked={on}
                onChange={(e) => togglePick(o.id, e.target.checked)}
              />
            </td>
            <td className="o-po mono">
              <Link href={`/orders/${o.id}`}>{ref(o)}</Link>
            </td>
            <td className="o-cust">
              <Link href={`/orders/${o.id}`}>{c.name}</Link>
            </td>
            <td className="o-chan">{slotText(c)}</td>
            <td className="o-note">{outlets(o).join(", ")}</td>
            <td className={`n o-date${isToday ? " due" : ""}`}>
              <span className="o-status-cell" style={{ justifyContent: "flex-end" }}>
                <OverdueLbl order={o} />
                <span>{relDay(o.date)}</span>
              </span>
            </td>
            <td className="o-col-act">
              <button type="button" className="o-row-act" onClick={() => onDeliver(o.id)}>
                Mark delivered
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
