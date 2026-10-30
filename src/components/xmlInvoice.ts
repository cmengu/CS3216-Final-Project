/** Presentation of the original HDon fields. Keep decimal strings; never calculate invoice money. */
export interface XmlParty {
  name: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface XmlInvoicePreview {
  title: string | null;
  number: string | null;
  date: string | null;
  series: string | null;
  currency: string | null;
  payment: string | null;
  seller: XmlParty;
  buyer: XmlParty;
  lines: {
    code: string | null;
    description: string | null;
    unit: string | null;
    quantity: string | null;
    unitPrice: string | null;
    amount: string | null;
    tax: string | null;
    discountRate: string | null;
    discountAmount: string | null;
    kind: string | null;
  }[];
  subtotal: string | null;
  tax: string | null;
  discount: string | null;
  total: string | null;
  totalWords: string | null;
}

function children(node: Element, name: string): Element[] {
  return Array.from(node.children).filter((child) => child.localName === name);
}

function at(node: Element, path: string): Element | null {
  let current: Element | null = node;
  for (const name of path.split("/")) {
    if (!current) return null;
    const matches = children(current, name);
    if (matches.length > 1) throw new Error("Duplicate invoice fields");
    current = matches[0] ?? null;
  }
  return current;
}

const text = (node: Element, path: string) => at(node, path)?.textContent?.trim() || null;

function party(node: Element, path: string): XmlParty {
  const field = (name: string) => text(node, `${path}/${name}`);
  return { name: field("Ten"), taxId: field("MST"), address: field("DChi"), phone: field("SDThoai"), email: field("DCTDTu") };
}

export function parseXmlInvoice(source: string): XmlInvoicePreview {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.doctype || document.getElementsByTagName("parsererror").length || document.documentElement.localName !== "HDon") throw new Error("Unsupported XML invoice");
  const invoice = at(document.documentElement, "DLHDon");
  if (!invoice) throw new Error("Invoice fields are missing");
  const list = at(invoice, "NDHDon/DSHHDVu");
  const header = (name: string) => text(invoice, `TTChung/${name}`);
  const total = (name: string) => text(invoice, `NDHDon/TToan/${name}`);
  return {
    title: header("THDon"), number: header("SHDon"), date: header("NLap"), series: header("KHHDon"), currency: header("DVTTe"), payment: header("HTTToan"),
    seller: party(invoice, "NDHDon/NBan"), buyer: party(invoice, "NDHDon/NMua"),
    lines: (list ? children(list, "HHDVu") : []).map((row) => ({
      code: text(row, "MHHDVu"), description: text(row, "THHDVu"), unit: text(row, "DVTinh"), quantity: text(row, "SLuong"), unitPrice: text(row, "DGia"), amount: text(row, "ThTien"), tax: text(row, "TSuat"), discountRate: text(row, "TLCKhau"), discountAmount: text(row, "STCKhau"), kind: text(row, "TChat"),
    })),
    subtotal: total("TgTCThue"), tax: total("TgTThue"), discount: total("TTCKTMai"), total: total("TgTTTBSo"), totalWords: total("TgTTTBChu"),
  };
}

/** Add grouping without a floating-point conversion, rounding, or losing trailing decimals. */
export function xmlNumber(value: string | null): string {
  if (value === null) return "Not provided";
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const [integer, fraction] = value.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

export function xmlRate(value: string | null): string {
  if (value === null) return "Not provided";
  return /^\d+(?:\.\d+)?$/.test(value) ? `${value}%` : value;
}
