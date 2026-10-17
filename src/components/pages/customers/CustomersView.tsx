"use client";

/* The Customers directory: search, All / Needs attention, and a sortable table of customers. */
import Link from "next/link";
import { useState } from "react";
import { CustomerIcon } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { PageActions } from "@/components/shell/PageActions";
import { meOf, useDemo } from "@/state/demo-store";
import { fmtDay, relDay } from "@/lib/format";
import { directoryRows, matches, sortRows, type DirectoryRow, type DirectorySort } from "./figures";

/* Kept for the page load, as the other lists keep their filters. */
type View = { q: string; show: "all" | "attention"; by: DirectorySort; desc: boolean };
let kept: View = { q: "", show: "all", by: "name", desc: false };
const keep = (v: View) => {
  kept = v;
};

const nextText = (r: DirectoryRow) => (r.next ? relDayOrDate(r.next.date) : "None scheduled");
const relDayOrDate = (d: string) => {
  const r = relDay(d);
  return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r : fmtDay(d);
};

const COLS: [DirectorySort | null, string][] = [
  ["name", "Customer"],
  ["open", "Open orders"],
  ["next", "Next delivery"],
  [null, "Contact"],
];

export function CustomersView() {
  const s = useDemo();
  const [st, setSt] = useState(kept);
  const set = (next: Partial<View>) => {
    const v = { ...st, ...next };
    keep(v);
    setSt(v);
  };

  const all = directoryRows(s, meOf(s));
  const attention = all.filter((r) => r.issue);
  const shown = sortRows((st.show === "attention" ? attention : all).filter((r) => matches(r, st.q)), st.by, st.desc);
  const sortBy = (by: DirectorySort) => set({ by, desc: st.by === by ? !st.desc : false });

  return (
    <>
      <Header className="cu-hd" title="div" acts={<PageActions />}>
        <span className="cu-mtitle">Customers</span>
      </Header>
      <div className="body cu">
        <h1 className="cu-h1">Customers</h1>
        <div className="cu-controls">
          <label className="cu-search">
            <Icon name="search" />
            <span className="sr">Search customers</span>
            <input type="search" placeholder="Search customers" value={st.q} onChange={(e) => set({ q: e.target.value })} />
          </label>
          <div className="cu-seg" role="group" aria-label="Show customers">
            <button type="button" aria-pressed={st.show === "all"} onClick={() => set({ show: "all" })}>
              All <span className="n">{all.length}</span>
            </button>
            <button type="button" aria-pressed={st.show === "attention"} onClick={() => set({ show: "attention" })}>
              Needs attention <span className="cu-pill warn">{attention.length}</span>
            </button>
          </div>
        </div>

        <section className="cu-card cu-dir" aria-label="Customer directory">
          {!all.length ? (
            <p className="cu-empty">No customers yet.</p>
          ) : !shown.length ? (
            <p className="cu-empty">{st.q ? `No customers match “${st.q.trim()}”.` : "No customers need attention."}</p>
          ) : (
            <div role="table" aria-label="Customers" aria-rowcount={shown.length + 1}>
              <div className="cu-dr cu-dh" role="row">
                {COLS.map(([k, l]) => (
                  <span role="columnheader" key={l} aria-sort={k && st.by === k ? (st.desc ? "descending" : "ascending") : undefined}>
                    {k ? (
                      <button type="button" className="cu-sort" onClick={() => sortBy(k)}>
                        {l}
                        <Icon name={st.by === k ? (st.desc ? "chevDown" : "chevUp") : "chevDown"} style={st.by === k ? undefined : { opacity: 0.45 }} />
                      </button>
                    ) : (
                      l
                    )}
                  </span>
                ))}
                <span role="columnheader">
                  <span className="sr">Open</span>
                </span>
              </div>
              {shown.map((r) => (
                <Link className="cu-dr" role="row" href={`/customers/${r.c.id}`} key={r.c.id}>
                  <span className="cu-who" role="cell">
                    <CustomerIcon c={r.c} />
                    <span className="cu-nm">
                      <b>{r.c.name}</b>
                      {r.issue ? (
                        <span className="cu-issue">
                          <i aria-hidden="true" />
                          {r.issue}
                        </span>
                      ) : null}
                      <span className="cu-meta">{`${r.open} open · ${nextText(r)} · ${r.contact}`}</span>
                    </span>
                  </span>
                  <span className="cu-c num" role="cell">
                    {r.open}
                  </span>
                  <span className="cu-c" role="cell">
                    {nextText(r)}
                  </span>
                  <span className="cu-c" role="cell">
                    {r.contact || "No contact"}
                  </span>
                  <span className="cu-chev" role="cell">
                    <Icon name="chev" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
