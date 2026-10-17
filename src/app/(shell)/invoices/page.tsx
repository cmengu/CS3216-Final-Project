import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesView } from "@/components/pages/invoices/InvoicesView";
import "@/app/styles/orders.css";
import "@/app/styles/invoices.css";

export const metadata: Metadata = { title: "Invoices · Invoice Checker" };

export default function Page() {
  // The workspace mode can start from ?mode=…, read on the client; the shell draws nothing before it mounts anyway.
  return (
    <Suspense fallback={null}>
      <InvoicesView />
    </Suspense>
  );
}
