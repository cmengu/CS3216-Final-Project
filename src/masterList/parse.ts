/** Canonical server import. Decimal values remain strings to preserve precision. */
export interface MasterItem {
  name: string;
  price: string;
  quantity: string | null;
  /** Undiscounted total; equals price when quantity is not supplied. */
  totalPrice?: string;
  supplier: string | null;
  po: string | null;
  item: string | null;
  description: string | null;
  unit: string | null;
  currency: string | null;
  discount: string | number | null;
  tax?: string | null;
  validFrom: string | null;
  validTo: string | null;
}
