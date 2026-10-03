import { RequireNav, SettingsStub } from "@/components/pages/Stubs";

export default async function Page({ params }: PageProps<"/settings/[pane]">) {
  const { pane } = await params;
  return (
    <RequireNav nav="settings">
      <SettingsStub pane={pane} />
    </RequireNav>
  );
}
