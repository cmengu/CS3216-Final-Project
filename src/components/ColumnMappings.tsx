"use client";

import type { ReactNode } from "react";
import type { ColumnMapping } from "@/masterList";
import { Dialog } from "./ui";

export const columnLabel = (field: string) => ({
  name: "Item name", price: "Unit price", quantity: "Quantity", supplier: "Supplier",
  item: "Item / part code", description: "Description", po: "PO reference", unit: "Unit",
  currency: "Currency", discount: "Discount", tax: "Tax", validFrom: "Valid from", validTo: "Valid to",
}[field] ?? field);

/** A file column as the clerk knows it: its heading, or "Column 3" when it has none. */
export const columnName = (columns: string[], index: number) => columns[index] || `Column ${index + 1}`;

export function ColumnMappings({ open, onClose, selection, children, footer }: {
  open: boolean; onClose: () => void; selection: ColumnMapping; children?: ReactNode; footer?: ReactNode;
}) {
  return <Dialog open={open} title="Column mappings" onClose={onClose}
    footer={footer ?? <button className="ic-btn ic-btn--primary" type="button" onClick={onClose}>Done</button>}>
    {children ?? <>
      <p className="ic-hint">The columns used from your file.</p>
      <table className="ic-grid ic-grid--strong"><thead><tr><th>Field</th><th>Column in your file</th></tr></thead>
        <tbody>{Object.entries(selection.mapping).map(([field, index]) => <tr key={field}>
          <td>{columnLabel(field)}</td><td>{columnName(selection.columns, index)}</td>
        </tr>)}</tbody>
      </table>
      {selection.mapping.quantity === undefined ? <p className="ic-hint">Quantity was not provided.</p> : null}
    </>}
  </Dialog>;
}
