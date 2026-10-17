"use client";

import Link from "next/link";
import { digestLines } from "@/components/pages/HomeView";
import { Icon } from "@/components/icons";
import { canInvoice, visibleOrders } from "@/platform/access";
import { meOf, useDemo } from "@/state/demo-store";
import { useShell } from "./context";

/**
 * Handover (copies the day's digest, as on Home) and Upload invoice (the Invoices page's upload
 * panel). Upload invoice shows only to people who may open Invoices.
 */
export function PageActions() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const handover = () => shell.copyText(digestLines(s, u, visibleOrders(s.orders, u)).join("\n"), "Copied handover");
  return (
    <>
      <button type="button" className="pa-hand" onClick={handover} aria-label="Handover: copy today's digest">
        <Icon name="copy" />
        <span>Handover</span>
      </button>
      {canInvoice(u) ? (
        <Link className="pa-up" href="/invoices#upload" aria-label="Upload invoice">
          <Icon name="arrowUp" />
          <span>Upload invoice</span>
        </Link>
      ) : null}
    </>
  );
}
