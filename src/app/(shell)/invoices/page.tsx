import { PlainStub, RequireNav } from "@/components/pages/Stubs";

export default function Page() {
  return (
    <RequireNav nav="invoices">
      <PlainStub title="Invoices" />
    </RequireNav>
  );
}
