/*
 * ⌘K results, ported from the prototype's palRender(): orders by PO number, customer or state,
 * customers by name, pages and a few actions, all within what this person may see.
 */
import { canEdit, navAllowed, seesCustomer, visibleOrders } from "@/platform/access";
import { NAV, type NavItem } from "@/platform/nav";
import type { DemoState, Person } from "@/sample";
import { ref, relDay, STATE, custOf } from "@/lib/format";

export type PaletteAction = "add" | "ask" | "theme";

export type PaletteHit =
  | { g: "Orders"; kind: "order"; id: string; ref: string; name: string; m: string }
  | { g: "Customers"; kind: "customer"; id: string; name: string; m: string }
  | { g: "Pages"; kind: "page"; nav: NavItem; m: "" }
  | { g: "Actions"; kind: "action"; action: PaletteAction; label: string; m: string }
  | { g: "Ask"; kind: "ask"; text: string; m: "" };

export function paletteHits(s: DemoState, me: Person, query: string): PaletteHit[] {
  const q = query.trim().toLowerCase();
  const out: PaletteHit[] = [];
  visibleOrders(s.orders, me)
    .filter((o) => !q || (custOf(s.customers, o.cust).name + " " + ref(o) + " " + STATE[o.state][1]).toLowerCase().includes(q))
    .slice(0, q ? 8 : 4)
    .forEach((o) => out.push({ g: "Orders", kind: "order", id: o.id, ref: ref(o), name: custOf(s.customers, o.cust).name, m: `${STATE[o.state][1]} · ${relDay(o.date)}` }));
  Object.values(s.customers)
    .filter((c) => seesCustomer(me, c.id) && (!q || c.name.toLowerCase().includes(q)))
    .slice(0, q ? 5 : 3)
    .forEach((c) => out.push({ g: "Customers", kind: "customer", id: c.id, name: c.name, m: c.id }));
  NAV.filter((n) => navAllowed(n.key, me) && (!q || n.label.toLowerCase().includes(q))).forEach((n) => out.push({ g: "Pages", kind: "page", nav: n, m: "" }));
  const acts: [PaletteAction, string, string][] = [
    ["ask", "Ask the assistant", "⌘I"],
    ["theme", "Toggle theme", ""],
  ];
  if (canEdit(me)) acts.unshift(["add", "Add orders", ""]);
  acts.filter(([, l]) => !q || l.toLowerCase().includes(q)).forEach(([action, label, m]) => out.push({ g: "Actions", kind: "action", action, label, m }));
  if (q && !out.length) out.push({ g: "Ask", kind: "ask", text: query, m: "" });
  return out;
}
