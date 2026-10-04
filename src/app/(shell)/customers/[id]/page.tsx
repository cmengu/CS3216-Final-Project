import { CustomerView } from "@/components/pages/customers/CustomerView";

export default async function Page({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  return <CustomerView id={id} />;
}
