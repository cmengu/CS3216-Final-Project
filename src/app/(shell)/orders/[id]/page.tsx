import { OrderView } from "@/components/pages/orders/OrderView";
import "@/app/styles/orders.css";

export default async function Page({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  return <OrderView key={id} id={id} />;
}
