import { OrderStub } from "@/components/pages/Stubs";

export default async function Page({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  return <OrderStub id={id} />;
}
