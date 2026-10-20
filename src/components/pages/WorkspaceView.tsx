"use client";

/*
 * Placeholder workspace: where every signed-in person lands while InvoiceTracker is cut back to
 * its three core features. It only links to what already works. The designed workspace (with the
 * Master list / Invoices / Check switcher) replaces this page; do not style it further.
 */
import Link from "next/link";
import { Header } from "@/components/shell/Header";
import { canInvoice } from "@/platform/access";
import { useMe } from "@/state/demo-store";

export function WorkspaceView() {
  const u = useMe();
  const invoices = canInvoice(u);
  return (
    <>
      <Header title="div">Workspace</Header>
      <div className="body">
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Workspace</h1>
        <p className="hint" style={{ margin: 0 }}>
          Placeholder. The redesigned workspace will switch between Master list, Invoices and Check.
        </p>
        <ul className="ws-links" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
          <li>
            <b>Master list</b>: set on the checking service (its price sheet). There is no upload in the app yet.
          </li>
          {invoices ? (
            <>
              <li>
                <Link href="/invoices#upload">Invoices: upload an invoice PDF</Link>
              </li>
              <li>
                <Link href="/invoices?mode=audit">Check: invoices waiting for a decision</Link>
              </li>
            </>
          ) : (
            <li>Invoices and Check: your role cannot open these.</li>
          )}
          <li>
            <Link href="/who">Switch person</Link>
          </li>
        </ul>
      </div>
    </>
  );
}
