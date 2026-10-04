"use client";

/* History: the prototype's historyView(). A table of every event in this person's view, with Person and Kind filters and Copy. */
import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { meOf, useDemo, useShownEvents } from "@/state/demo-store";
import { ref } from "@/lib/format";
import { applyFilter, filterOptions, historyRows, kindClass, kindText, type HistoryFilter } from "./rows";

/* The prototype keeps the filter in memory (S._hf) for the page load, so it survives leaving and coming back. */
let kept: HistoryFilter = { who: "", kind: "" };

const selStyle = { padding: "4px 8px", fontSize: 12 };

export function HistoryView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const table = useRef<HTMLTableElement>(null);
  const [f, setF] = useState<HistoryFilter>(kept);
  const set = (next: Partial<HistoryFilter>) => {
    kept = { ...f, ...next };
    setF(kept);
  };

  const rows = historyRows({ ...s, events: useShownEvents() }, u);
  const { kinds, whos } = filterOptions(rows);
  const shown = applyFilter(rows, f);

  return (
    <>
      <Header
        acts={
          <>
            <select value={f.who} onChange={(e) => set({ who: e.target.value })} aria-label="Person" style={selStyle}>
              <option value="">Everyone</option>
              {whos.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
            <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Kind" style={selStyle}>
              <option value="">All events</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindText(k)}
                </option>
              ))}
            </select>
            <button className="btn s g" onClick={() => shell.copyText(table.current?.innerText ?? "", `Copied ${shown.length} rows`)}>
              <Icon name="copy" />
            </button>
          </>
        }
      >
        History
      </Header>
      <div className="body">
        <div className="scroll">
          <table className="tbl ht" ref={table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Event</th>
                <th>Detail</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const o = r.order ? s.orders.find((x) => x.id === r.order) : null;
                return (
                  <tr key={i}>
                    <td className="mono" style={{ color: "var(--ink3)", whiteSpace: "nowrap" }}>
                      {r.at.slice(5)}
                    </td>
                    <td>{r.who}</td>
                    <td>
                      <span className={`lbl ${kindClass(r.kind)}`}>{kindText(r.kind)}</span>
                    </td>
                    <td>{r.text}</td>
                    <td>
                      {o ? (
                        <Link href={`/orders/${o.id}`} className="mono">
                          {ref(o)}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
