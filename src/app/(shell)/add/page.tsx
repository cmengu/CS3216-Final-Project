import { AddView } from "@/components/pages/AddView";
import { RequireNav } from "@/components/pages/Stubs";

export default function Page() {
  return (
    <RequireNav nav="add">
      <AddView />
    </RequireNav>
  );
}
