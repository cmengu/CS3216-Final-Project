import type { MailItem } from "./types";

/* What the orders mailbox holds once connected: the look-alike sample POs, as the prototype's MAIL0. */
export const SAMPLE_MAIL: MailItem[] = [
  { from: "Harbour Hotel · purchasing", subj: "PO HH-2240", file: "PO_HH-2240_HarbourHotel.pdf", at: "11:32", size: 184320 },
  { from: "Pavilion Kitchen", subj: "Order for Monday", file: "PO_PK-331_Pavilion.pdf", at: "11:20", size: 96256 },
  { from: "Harbour Hotel · purchasing", subj: "Fwd: PO HH-2231", file: "PO_HH-2231.pdf", at: "10:58", size: 188416 },
];
