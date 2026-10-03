/* Small shared pieces: status label, customer mark. Markup as the prototype's lbl() and avc(). */
import type { Customer, Order, OrderState } from "@/sample";
import { Icon } from "@/components/icons";
import { initials, isOverdue, STATE } from "@/lib/format";
import type { CSSProperties } from "react";

export function Lbl({ state }: { state: OrderState }) {
  const [cls, label, icon] = STATE[state] ?? ["l-mute", state, "doc"];
  return (
    <span className={`lbl ${cls}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}

export function OverdueLbl({ order }: { order: Order }) {
  if (!isOverdue(order)) return null;
  return (
    <span className="lbl l-over">
      <Icon name="clock" />
      Overdue
    </span>
  );
}

/** The customer's round mark: its logo on a tint of its colour, or initials. */
export function CustomerMark({ c }: { c: Customer }) {
  const style = { "--c": c.color || "#777" } as CSSProperties;
  if (c.logo)
    return (
      <span className="avc lg" style={style}>
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: c.logo }} />
      </span>
    );
  return (
    <span className="avc" style={style}>
      {initials(c.name)}
    </span>
  );
}
