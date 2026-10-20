import type { Metadata } from "next";
import { WorkspaceView } from "@/components/pages/WorkspaceView";

export const metadata: Metadata = { title: "Workspace · Invoice Checker" };

export default function Page() {
  return <WorkspaceView />;
}
