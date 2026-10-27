import { money, unit } from "@/checker/present";
import type { InvoiceLine } from "@/checker/types";

export function PriceComparison({ line, currency, number }: { line: InvoiceLine; currency: string | null; number: number }) {
  const uom = line.unit?.toUpperCase() === "M3" ? "m³" : line.unit;
  const suffix = uom ? ` / ${uom}` : "";
  const price = (value: number | null) => value === null ? "—" : `${currency ? currency + " " : ""}${unit(value)}${suffix}`;
  const qty = line.quantity === null ? "—" : `${line.quantity.toLocaleString("en-SG")}${uom ? " " + uom : ""}`;
  const masterTotal = line.sheetPrice !== null && line.quantity !== null ? Math.round(line.sheetPrice * line.quantity * 100) / 100 : null;
  const differs = line.result === "price_mismatch" && line.difference !== null && line.difference !== 0;
  return <div className="ic-line-comparison">
    <table aria-label={`Price comparison for line ${number}`}>
      <thead><tr><th scope="col"><span className="sr">Source</span></th><th scope="col">Unit price</th><th scope="col">Qty</th><th scope="col">Total</th></tr></thead>
      <tbody>
        <tr><th scope="row">Invoice</th><td>{price(line.unitPrice)}</td><td>{qty}</td><td>{line.lineTotal === null ? "—" : money(line.lineTotal, currency)}</td></tr>
        <tr><th scope="row">Master</th><td className={differs ? "ic-price-diff" : undefined}>{price(line.sheetPrice)}</td><td>{qty}</td><td className={differs && masterTotal !== null && line.lineTotal !== null && masterTotal !== line.lineTotal ? "ic-price-diff" : undefined}>{masterTotal === null ? "—" : money(masterTotal, currency)}</td></tr>
      </tbody>
    </table>
  </div>;
}
