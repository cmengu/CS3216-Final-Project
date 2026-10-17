import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
// Home draws on its own route and in place of any route a role may not open, so its styles load with the shell.
import "@/app/styles/home.css";
// Customers and the shared header actions (Handover, Upload invoice).
import "@/app/styles/customers.css";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
