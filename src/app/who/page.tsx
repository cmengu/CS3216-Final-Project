import { WhoGate } from "@/components/pages/WhoGate";

export default async function Page({ searchParams }: PageProps<"/who">) {
  const { pin } = await searchParams;
  return <WhoGate key={typeof pin === "string" ? pin : ""} pinFor={typeof pin === "string" ? pin : undefined} />;
}
