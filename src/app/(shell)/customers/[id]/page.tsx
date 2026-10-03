import { CustomerStub } from "@/components/pages/Stubs";

export default async function Page({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  return <CustomerStub id={id} />;
}
