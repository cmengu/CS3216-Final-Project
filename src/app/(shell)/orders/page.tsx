import { Suspense } from "react";
import { OrdersView } from "@/components/pages/orders/OrdersView";
import "@/app/styles/orders.css";

export default function Page() {
  // The tab lives in ?state=…, read on the client; the shell draws nothing before it mounts anyway.
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}
