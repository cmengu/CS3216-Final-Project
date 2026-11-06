import { lineTone, LINE_TOTAL_WRONG, money, unit } from "@/checker/present";
import { overSheet } from "@/checker/review";
import type { InvoiceLine } from "@/checker/types";
import { Icon } from "@/components/icons";

/** A line's status icon: a tick when it matches, a red bold warning when over, a blue question mark when unknown. */
export function LineIcon({ line, totalsOnly, size }: { line: InvoiceLine; totalsOnly?: boolean; size?: "row" }) {
  if (totalsOnly) return <Icon name="doc" size={size} />;
  const tone = lineTone(line);
  if (tone === "good") return <Icon name="tick" size={size} style={{ color: "var(--good)", strokeWidth: 2 }} />;
  return <Icon name={tone === "info" ? "question" : "warn"} size={size} style={{ color: `var(--${tone})`, strokeWidth: tone === "bad" ? 2.4 : 1.8 }} />;
}

export function PriceComparison({ line, currency, number }: { line: InvoiceLine; currency: string | null; number: number }) {
  const uom = line.unit?.toUpperCase() === "M3" ? "m³" : line.unit;
  const suffix = uom ? ` / ${uom}` : "";
  const price = (value: number | null) => value === null ? "—" : `${currency ? currency + " " : ""}${unit(value)}${suffix}`;
  const qty = line.quantity === null ? "—" : `${line.quantity.toLocaleString("en-SG")}${uom ? " " + uom : ""}`;
  const masterTotal = line.sheetPrice !== null && line.quantity !== null ? Math.round(line.sheetPrice * line.quantity * 100) / 100 : null;
  const differs = line.result === "price_mismatch" && line.difference !== null && line.difference !== 0;
  const diff = differs ? (overSheet(line) ? "ic-price-diff" : "ic-price-under") : undefined;
  const totalWrong = line.reason === LINE_TOTAL_WRONG;
  return <div className="ic-line-comparison">
    <table aria-label={`Price comparison for line ${number}`}>
      <thead><tr><th scope="col"><span className="sr">Source</span></th><th scope="col">Unit price</th><th scope="col">Qty</th><th scope="col">Total</th></tr></thead>
      <tbody>
        <tr><th scope="row">Invoice</th><td>{price(line.unitPrice)}</td><td>{qty}</td><td className={totalWrong ? "ic-total-wrong" : undefined}>{line.lineTotal === null ? "—" : money(line.lineTotal, currency)}</td></tr>
        <tr><th scope="row">Master</th><td className={diff}>{price(line.sheetPrice)}</td><td>{qty}</td><td className={differs && masterTotal !== null && line.lineTotal !== null && masterTotal !== line.lineTotal ? diff : undefined}>{masterTotal === null ? "—" : money(masterTotal, currency)}</td></tr>
      </tbody>
    </table>
  </div>;
}
