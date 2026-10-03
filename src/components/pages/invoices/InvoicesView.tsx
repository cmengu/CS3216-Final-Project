"use client";

/*
 * Invoices, as the prototype's invoicesView(): delivered orders, To invoice / Invoiced, grouped by customer.
 * Owner and Finance only; everyone else gets Not found. The Excel button only shows a toast, as in the
 * prototype; the real writer comes later from the importer library.
 */
import Link from "next/link";
import { useState } from "react";
import { CustomerMark } from "@/components/bits";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canInvoice, canPrice } from "@/platform/access";
import { invoice, invoiceAll } from "@/state/actions/invoices";
import { meOf, useDemo } from "@/state/demo-store";
import { money, orderTotal, ref, relDay } from "@/lib/format";
import { deliveredOn, groupByCustomer, invoiceCsv, invoiceLists, listTotal, type InvoiceTab } from "./invoices";

export function InvoicesView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [tab, setTab] = useState<InvoiceTab>("open");
  if (!canInvoice(u)) return <Header>Not found</Header>;

  const price = canPrice(u);
  const { open, done } = invoiceLists(s, u);
  const list = tab === "open" ? open : done;
  const groups = groupByCustomer(list);

  const one = (id: string) => {
    const n = invoice(id);
    if (n) shell.toast(`Invoiced ${n}`);
  };
  const all = () => shell.toast(`${invoiceAll()} invoiced`);

  return (
    <>
      <Header
        acts={
          <>
            <button className="btn s" onClick={() => shell.copyText(invoiceCsv(s, u, tab), `Copied CSV · ${list.length} rows`)}>
              <Icon name="copy" />
              Copy CSV
            </button>
            <button className="btn s" onClick={() => shell.toast("Downloaded invoices.xlsx")}>
              <Icon name="dl" />
              Excel
            </button>
          </>
        }
      >
        Invoices
      </Header>
      <div className="tabs">
        <Link
          className={`tab ${tab === "open" ? "on" : ""}`}
          href="/invoices"
          onClick={(e) => {
            e.preventDefault();
            setTab("open");
          }}
        >
          To invoice<span className="n">{open.length}</span>
        </Link>
        <Link
          className={`tab ${tab === "done" ? "on" : ""}`}
          href="/invoices"
          onClick={(e) => {
            e.preventDefault();
            setTab("done");
          }}
        >
          Invoiced<span className="n">{done.length}</span>
        </Link>
        <span className="sp" />
        <span className="hint" style={{ padding: "5px 0" }}>
          {price ? money(listTotal(list)) + " before GST" : ""}
        </span>
      </div>
      <div className="body">
        {groups.length ? (
          groups.map((g) => {
            const c = s.customers[g.cust];
            return (
              <div className="inv-grp" key={g.cust}>
                <div className="gh">
                  <CustomerMark c={c} />
                  <b>{c.name}</b>
                  <span className="tag">{c.terms}</span>
                  <span className="hint">{`${g.orders.length} order${g.orders.length > 1 ? "s" : ""}`}</span>
                  {price ? <span className="tot">{money(g.total)}</span> : null}
                </div>
                {g.orders.map((o) => (
                  <Link
                    className="row"
                    href={`/orders/${o.id}`}
                    key={o.id}
                    style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto auto" }}
                  >
                    <b className="mono" style={{ fontWeight: 500 }}>
                      {ref(o)}
                    </b>
                    <span className="sub">{`delivered ${relDay(deliveredOn(s.events, o)).toLowerCase()} · ${o.lines.length} lines`}</span>
                    {o.invoiced ? <span className="tag">{o.invoiced}</span> : null}
                    <span className="when">{price ? money(orderTotal(o)) : ""}</span>
                    <span>
                      {!o.invoiced && canInvoice(u) ? (
                        <button
                          className="btn s"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            one(o.id);
                          }}
                        >
                          Mark invoiced
                        </button>
                      ) : null}
                    </span>
                  </Link>
                ))}
              </div>
            );
          })
        ) : (
          <div className="empty">Nothing to invoice.</div>
        )}
        {tab === "open" && open.length && canInvoice(u) ? (
          <div>
            <button className="btn p" onClick={all}>
              <Icon name="inv" />
              {`Mark all ${open.length} invoiced`}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
