"use client";

/* The Customers list, as the prototype's customersView(). */
import Link from "next/link";
import { CustomerMark } from "@/components/bits";
import { Header } from "@/components/shell/Header";
import { meOf, useDemo } from "@/state/demo-store";
import { relDay } from "@/lib/format";
import { listRow, visibleCustomers } from "./figures";

export function CustomersView() {
  const s = useDemo();
  const list = visibleCustomers(s, meOf(s));
  return (
    <>
      <Header icon="building">Customers</Header>
      <div className="grp" style={{ paddingTop: 6 }}>
        {list.map((c) => {
          const r = listRow(s, c);
          return (
            <Link className="row" href={`/customers/${c.id}`} key={c.id} style={{ gridTemplateColumns: "auto auto minmax(0,1fr) auto" }}>
              <span className="who">
                <CustomerMark c={c} />
                <b>{c.name}</b>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <span className="lbl l-mute">{c.kind || "Customer"}</span>
                {r.open ? <span className="lbl l-info">{`${r.open} open`}</span> : null}
              </span>
              <span className="sub">
                <b>{`${r.m30} in 30 days`}</b>
                {`${c.sender} · ${c.days} · ${c.outlets.length} outlet${c.outlets.length > 1 ? "s" : ""}`}
              </span>
              <span className="when">{r.last ? "last " + relDay(r.last.date).toLowerCase() : ""}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
