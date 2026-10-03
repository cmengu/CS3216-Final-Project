import { notFound } from "next/navigation";
import { isPaneId } from "@/components/pages/settings/pane-ids";
import { SettingsView } from "@/components/pages/settings/SettingsView";
import "@/app/styles/settings.css";

export default async function Page({ params }: PageProps<"/settings/[pane]">) {
  const { pane } = await params;
  if (!isPaneId(pane)) notFound();
  return <SettingsView pane={pane} />;
}
