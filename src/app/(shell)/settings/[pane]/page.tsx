import { isPaneId } from "@/components/pages/settings/pane-ids";
import { SettingsView } from "@/components/pages/settings/SettingsView";
import "@/app/styles/settings.css";

export default async function Page({ params }: PageProps<"/settings/[pane]">) {
  const { pane } = await params;
  // An unknown pane shows the first one, as the prototype's settingsView does.
  return <SettingsView pane={isPaneId(pane) ? pane : "lists"} />;
}
