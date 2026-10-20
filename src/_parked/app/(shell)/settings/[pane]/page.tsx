import { isPaneId } from "@/_parked/components/pages/settings/pane-ids";
import { SettingsView } from "@/_parked/components/pages/settings/SettingsView";
import "@/_parked/app/styles/settings.css";

export default async function Page({ params }: { params: Promise<{ pane: string }> }) {
  const { pane } = await params;
  // An unknown pane shows the first one, as the prototype's settingsView does.
  return <SettingsView pane={isPaneId(pane) ? pane : "lists"} />;
}
