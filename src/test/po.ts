/* An invented purchase order, shaped as the importer's readers return one, for unit tests. */
import type { EgcPurchaseOrder } from "@/lib/importer";

const line = (lineNumber: number, description: string, quantity: number, unitPrice: number | null, outlet = "") => ({
  lineNumber,
  itemCode: "",
  description,
  quantity,
  unit: "BOX",
  unitPrice,
  discount: null,
  lineAmount: null,
  taxAmount: null,
  outlet,
  deliveryDate: null,
  evidence: [],
});

export function harbourPo(over: Partial<EgcPurchaseOrder["header"]> = {}): EgcPurchaseOrder {
  return {
    source: { kind: "pdf", fileName: "PO_HH-2240.pdf", readerId: "buynow" },
    header: {
      poNumber: "HH-2240",
      buyerName: "Harbour Hotel Pte Ltd",
      orderDate: "2026-10-01",
      deliveryDate: "2026-10-05",
      deliverTo: "",
      currency: "SGD",
      subtotal: null,
      taxAmount: null,
      grandTotal: null,
      remarks: "",
      ...over,
    },
    lines: [line(1, "Pea tendrils", 4, 5.4, "Banquet kitchen"), line(2, "Micro basil 50g", 2, 4.5, "Banquet kitchen"), line(3, "Edible flower mix (tray)", 1, null, "Room service")],
    assignedCustomerId: null,
    warnings: [],
  };
}
