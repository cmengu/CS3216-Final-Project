import { PlainStub, RequireNav } from "@/components/pages/Stubs";

export default function Page() {
  return (
    <RequireNav nav="people">
      <PlainStub title="People" />
    </RequireNav>
  );
}
