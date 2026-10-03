/* The PDFs waiting in the orders mailbox once one is connected (prototype: MAIL0). All invented. */
import type { MailItem } from "./types";

export const MAIL0: readonly MailItem[] = [
  { from: "Harbour Hotel · purchasing", subj: "PO HH-2240", file: "PO_HH-2240_HarbourHotel.pdf", at: "11:32", sample: "a", size: 184320 },
  { from: "Pavilion Kitchen", subj: "Order for Monday", file: "PO_PK-331_Pavilion.pdf", at: "11:20", sample: "b", size: 96256 },
  { from: "Harbour Hotel · purchasing", subj: "Fwd: PO HH-2231", file: "PO_HH-2231.pdf", at: "10:58", sample: "d", size: 188416 },
];

/** The example "Try an example" pastes into Add orders. */
export const PASTE_EXAMPLE = "Hi, order for Mon pls\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red x1\nthanks!";
