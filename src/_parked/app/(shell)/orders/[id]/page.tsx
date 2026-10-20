import { OrderView } from "@/_parked/components/pages/orders/OrderView";
import "@/app/styles/orders.css";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderView key={id} id={id} />;
}
