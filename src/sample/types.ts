/* Types for the invented demo data. A database seed can be generated from the same shapes later. */

export type Role = "owner" | "coordinator" | "account_manager" | "packing" | "finance";

export interface Product {
  id: string; // SKU, e.g. EGC-PTND
  name: string;
  unit: string;
  price: number; // unit price before GST
}

export type Slot = "AM" | "PM" | "Unspecified";

export interface Customer {
  id: string; // Customer ID, e.g. C10243
  name: string;
  kind: string; // Hotel, Restaurant, Members club, Deli
  color: string; // the customer's mark colour
  logo: string; // inner SVG markup for the 24x24 logo mark (invented)
  layout: string; // the PO layout this customer sends
  outlets: string[];
  location: string;
  delivery: "Delivery" | "Pickup";
  slot: Slot;
  sender: string; // who sends the orders
  channel: string; // how POs arrive
  days: string; // usual order days
  terms: string; // payment terms
  notes: string[];
}

export interface Person {
  id: string;
  name: string;
  role: Role;
  email: string;
  customers: "all" | string[];
  invite?: string;
}

export type OrderState = "confirmed" | "needs_check" | "blocked" | "delivered" | "draft";
export type LineOrigin = "po" | "manual" | "unresolved";

export interface OrderLine {
  sku: string | null;
  qty: number;
  unit: string;
  outlet: string;
  origin: LineOrigin;
  desc?: string; // the PO's own words when no SKU matched
}

export interface SourceFile {
  name: string;
  size: number;
  at: string;
  hash: string;
  /** The importer's fingerprint of the PDF's text, for recognising the same PO again. */
  contentHash?: string;
  /** The layout reader that read it (Add orders); seeded orders use the customer's layout. */
  layout?: string;
}

export interface Order {
  id: string;
  cust: string;
  po: string | null;
  date: string; // delivery date, YYYY-MM-DD
  state: OrderState;
  source: "pdf" | "whatsapp";
  exported: boolean;
  confirmedBy: string | null;
  invoiced?: string;
  file?: SourceFile;
  fromAdd?: boolean;
  unparsed?: string[];
  lines: OrderLine[];
}

export interface OrderEvent {
  order: string;
  at: string; // YYYY-MM-DD HH:MM
  kind: string;
  actor: string;
  text: string;
}

export interface Message {
  id: string;
  order: string;
  at: string;
  from: string;
  source: string;
  text: string;
  linkedBy: string;
}

export interface Diff {
  line: number;
  field: string;
  old: string;
  new: string;
  outlet: string;
}

export type ToCheck =
  | { id: string; kind: "revision"; order: string; diff: Diff[]; from: string }
  | { id: string; kind: "cell"; order: string; text: string };

export interface Alias {
  text: string;
  sku: string | null;
  state: "approved" | "proposed";
  by: string | null;
  seen?: string;
}

export interface HistoryEntry {
  at: string;
  who: string;
  kind: string;
  order: string | null;
  text: string;
}

export interface Connections {
  mail: { kind: string; at: string } | null;
  mailFlow: string | null;
  paste: boolean;
  wa: string | null;
}

export interface MailItem {
  from: string;
  subj: string;
  file: string;
  at: string;
  size: number;
  sample?: string; // which invented sample PO this file reads as
}

/** What the acknowledgement includes (prototype: S.settings.reply). */
export interface ReplyOptions {
  lines: boolean;
  date: boolean;
  sign: boolean;
}

export interface Settings {
  retainsRows: boolean;
  retentionDays: number;
  skuCount: number;
  skuDate: string;
  style: string;
  reply?: ReplyOptions; // unset until a reply toggle is touched; defaults to all on
}

export interface DemoState {
  customers: Record<string, Customer>;
  people: Person[];
  orders: Order[];
  events: OrderEvent[];
  messages: Message[];
  toCheck: ToCheck[];
  aliases: Alias[];
  history: HistoryEntry[];
  drafts: { order: string; text: string }[];
  comments: { order: string; at: string; who: string; text: string }[];
  keys: { id: string; label: string; who: string; masked: string }[];
  cols: string[] | null;
  settings: Settings;
  cx: Connections;
  mailbox: MailItem[] | null; // PDFs waiting in the orders mailbox, once one is connected
  user: string;
  chat: unknown[];
  seq: number;
  src: "pdf" | "wa" | "mail";
  layout: "egc" | "packing";
}
