"use client";

import type { ReactNode } from "react";
import type { ColumnMapping } from "@/masterList";
import { Dialog } from "./ui";

export const columnLabel = (field: string) => ({
  name: "Item name", price: "Unit price", quantity: "Quantity", supplier: "Supplier",
  item: "Item / part code", description: "Description", po: "PO reference", unit: "Unit",
  currency: "Currency", discount: "Discount", tax: "Tax", validFrom: "Valid from", validTo: "Valid to",
}[field] ?? field);

export function ColumnMappings({ open, onClose, selection, children, footer }: {
  open: boolean; onClose: () => void; selection: ColumnMapping; children?: ReactNode; footer?: ReactNode;
}) {
  return <Dialog open={open} title="Column mappings" onClose={onClose}
    sub={`${selection.sheet} · Header row ${selection.header + 1}`}
    footer={footer ?? <button className="ic-btn ic-btn--primary" type="button" onClick={onClose}>Done</button>}>
    {children ?? <>
      <p className="ic-hint">These are the spreadsheet columns used for your master list.</p>
      <table className="ic-grid"><thead><tr><th>Master list field</th><th>Spreadsheet column</th></tr></thead>
        <tbody>{Object.entries(selection.mapping).map(([field, index]) => <tr key={field}>
          <td>{columnLabel(field)}</td><td>{index + 1}: {selection.columns[index] || "Unnamed column"}</td>
        </tr>)}</tbody>
      </table>
      {selection.mapping.quantity === undefined ? <p className="ic-hint">Quantity was not provided.</p> : null}
    </>}
  </Dialog>;
}
