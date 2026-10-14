import { InvoiceView } from "@/components/pages/invoices/InvoiceView";
import "@/app/styles/orders.css";
import "@/app/styles/invoices.css";

export default async function Page({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  return <InvoiceView key={id} id={id} />;
}
