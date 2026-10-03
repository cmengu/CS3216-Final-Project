/*
 * The PDFs waiting in the orders mailbox once one is connected (prototype: MAIL0): the importer's
 * look-alike sample POs (served from public/samples/), with invented senders.
 */
import type { MailItem } from "./types";

export const MAIL0: readonly MailItem[] = [
  { from: "Harbour Hotel · purchasing", subj: "PO HH-2240", file: "harbour-hotel-hh-2240.pdf", at: "11:32", size: 9395 },
  { from: "Pavilion Kitchen", subj: "Order for Monday", file: "pavilion-kitchen-pk-331.pdf", at: "11:20", size: 4714 },
  { from: "Marina Grand · purchasing", subj: "PO MGP00000613", file: "marina-grand-departments.pdf", at: "10:58", size: 7762 },
];

/** The example "Try an example" pastes into Add orders. */
export const PASTE_EXAMPLE = "Hi, order for Mon pls\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red x1\nthanks!";
