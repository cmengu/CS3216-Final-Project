/*
 * The PDFs waiting in the orders mailbox once one is connected (prototype: MAIL0), with the
 * prototype's invented senders, subjects, file names, times and sizes.
 */
import type { MailItem } from "./types";

export const MAIL0: readonly MailItem[] = [
  { from: "Harbour Hotel · purchasing", subj: "PO HH-2240", file: "PO_HH-2240_HarbourHotel.pdf", at: "11:32", size: 4805 },
  { from: "Pavilion Kitchen", subj: "Order for Monday", file: "PO_PK-331_Pavilion.pdf", at: "11:20", size: 4288 },
  { from: "Harbour Hotel · purchasing", subj: "Fwd: PO HH-2231", file: "PO_HH-2231.pdf", at: "10:58", size: 6001 },
];
