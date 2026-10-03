/* Small formatting and order helpers, ported from the prototype's helper block. */
import { PRODUCTS, TODAY } from "@/sample";
import type { Customer, Order, OrderLine, OrderState } from "@/sample";
import type { IconName } from "@/components/icons";

const at0 = (d: string) => new Date(d + "T00:00:00");

export const fmtDay = (d: string) => at0(d).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
export const fmtShort = (d: string) => at0(d).toLocaleDateString("en-SG", { day: "numeric", month: "short" });
export const money = (n: number) => "$" + n.toFixed(2);
export const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function addDays(d: string, n: number): string {
  const dt = at0(d);
  dt.setDate(dt.getDate() + n);
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

/** The order's reference: its PO number, or WA-MMDD-<last two of the customer ID> for WhatsApp orders. */
export const ref = (o: Pick<Order, "po" | "date" | "cust">) => o.po || "WA-" + o.date.slice(5).replace("-", "") + "-" + o.cust.slice(-2);

export const isOverdue = (o: Order) => o.date < TODAY && !["delivered", "draft"].includes(o.state);
export const lineTotal = (l: OrderLine) => (l.sku ? PRODUCTS[l.sku].price * l.qty : 0);
export const orderTotal = (o: Order) => o.lines.reduce((a, l) => a + lineTotal(l), 0);
export const outlets = (o: Order) => [...new Set(o.lines.map((l) => l.outlet))];
export const slotText = (c: Customer) => (c.slot === "Unspecified" ? "any time" : c.slot);

export const dayLabel = (d: string) =>
  d === TODAY
    ? "Today"
    : d === addDays(TODAY, 1)
      ? "Tomorrow"
      : d > TODAY && d <= addDays(TODAY, 6)
        ? "This week"
        : d > TODAY
          ? "Later"
          : d >= "2026-09-28"
            ? "Earlier this week"
            : "Earlier";

export const relDay = (d: string) =>
  d === TODAY ? "Today" : d === addDays(TODAY, 1) ? "Tomorrow" : d === addDays(TODAY, -1) ? "Yesterday" : fmtShort(d);

/** Lower-case the first letter of a sentence, so "Read PO" reads as "read PO" after a name. */
export const lc = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

export const evIcon = (k: string): IconName =>
  /confirm|approve|deliver/.test(k)
    ? "check"
    : /revision|received_again|blocked|dismiss|unconfirm/.test(k)
      ? "warn"
      : /message|comment/.test(k)
        ? "chat"
        : /export/.test(k)
          ? "dl"
          : /replied/.test(k)
            ? "reply"
            : /price/.test(k)
              ? "eye"
              : /invoice/.test(k)
                ? "inv"
                : /read/.test(k)
                  ? "doc"
                  : "clock";

export const STATE: Record<OrderState, [cls: string, label: string, icon: IconName]> = {
  confirmed: ["l-good", "Confirmed", "check"],
  needs_check: ["l-warn", "Needs check", "warn"],
  blocked: ["l-bad", "Blocked", "x"],
  delivered: ["l-mute", "Delivered", "truck"],
  draft: ["l-info", "Draft", "doc"],
};

export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** "YYYY-MM-DD HH:MM" on the demo's fixed today, at the current clock time (the prototype's nowStr). */
export const nowStr = (d: Date = new Date()) => TODAY + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
