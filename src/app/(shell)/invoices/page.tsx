import type { Metadata } from "next";
import { InvoicesView } from "@/components/pages/invoices/InvoicesView";
import "@/app/styles/orders.css";
import "@/app/styles/invoices.css";

export const metadata: Metadata = { title: "Invoices · Invoice Checker" };

export default function Page() {
  return <InvoicesView />;
}
