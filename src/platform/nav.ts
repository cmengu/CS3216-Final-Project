import type { IconName } from "@/components/icons";
import type { DemoState, MailItem } from "@/sample";
import { MAIL0 } from "@/sample/mail";
import type { Person } from "@/sample/types";
import { navAllowed, type NavKey } from "./access";

/** Which part of the rail an item sits in: the invoice checker, or the earlier order-tracking demo. */
export type NavGroup = "checker" | "orders";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: IconName;
  href: string;
  group: NavGroup;
}

/** The side rail, in the prototype's order. Hidden by role through navAllowed(). */
export const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "home", href: "/home", group: "orders" },
  { key: "orders", label: "Orders", icon: "list", href: "/orders", group: "orders" },
  { key: "customers", label: "Customers", icon: "building", href: "/customers", group: "orders" },
  { key: "invoices", label: "Invoices", icon: "inv", href: "/invoices", group: "checker" },
  { key: "people", label: "People", icon: "people", href: "/people", group: "orders" },
  { key: "history", label: "History", icon: "clock", href: "/history", group: "orders" },
  { key: "settings", label: "Settings", icon: "gear", href: "/settings/lists", group: "orders" },
];

/**
 * The rail's sections, in order. The invoice checker leads; the order demo keeps its pages under
 * its own heading, so more tools can join the rail later without reshuffling it.
 */
export const NAV_GROUPS: { key: NavGroup; label: string | null }[] = [
  { key: "checker", label: null },
  { key: "orders", label: "Order demo" },
];

/** Where a person lands after picking who they are: Invoices when they may open it, else Home. */
export const landingFor = (p: Person) => (navAllowed("invoices", p) ? "/invoices" : "/home");

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
