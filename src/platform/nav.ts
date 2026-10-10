import type { IconName } from "@/components/icons";
import type { DemoState, MailItem } from "@/sample";
import { MAIL0 } from "@/sample/mail";
import type { NavKey } from "./access";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: IconName;
  href: string;
}

/** The side rail, in the prototype's order. Hidden by role through navAllowed(). */
export const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "home", href: "/home" },
  { key: "orders", label: "Orders", icon: "list", href: "/orders" },
  { key: "customers", label: "Customers", icon: "building", href: "/customers" },
  { key: "invoices", label: "Invoices", icon: "inv", href: "/invoices" },
  { key: "people", label: "People", icon: "people", href: "/people" },
  { key: "history", label: "History", icon: "clock", href: "/history" },
  { key: "settings", label: "Settings", icon: "gear", href: "/settings/lists" },
];

/** Which rail item a path belongs to. */
export function navKeyOf(pathname: string): NavKey | null {
  const first = pathname.split("/")[1] || "";
  return (NAV.find((n) => n.key === first)?.key as NavKey | undefined) ?? null;
}

/** New PDFs in the orders mailbox; empty until a mailbox is connected. */
export const mailbox = (s: DemoState): MailItem[] => (s.cx.mail ? (s.mailbox ?? MAIL0.map((m) => ({ ...m }))) : []);

export const SETTINGS_PANES = [
  ["lists", "Products and customers"],
  ["aliases", "Aliases"],
  ["connections", "Connections"],
  ["retention", "Retention"],
  ["replies", "Replies"],
  ["assistant", "Assistant access"],
] as const;
