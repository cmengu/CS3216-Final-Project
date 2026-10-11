/* A supplier's round mark: initials on a tint of a colour picked from its name, or a document icon before the name is read. */
import type { CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { initials } from "@/lib/format";

const COLORS = ["#2B5BA8", "#62479E", "#28633A", "#B4530A", "#0F766E", "#9C1C1C"];

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function SupplierMark({ name }: { name: string | null }) {
  if (!name)
    return (
      <span className="avc lg" style={{ "--c": "#777" } as CSSProperties}>
        <Icon name="doc" />
      </span>
    );
  return (
    <span className="avc ck-mark" style={{ "--c": colorOf(name) } as CSSProperties}>
      {initials(name.replace(/\b(Pte|Ltd|Supply)\b\.?/g, ""))}
    </span>
  );
}
