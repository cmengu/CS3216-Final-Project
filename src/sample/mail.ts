/*
 * The PDFs waiting in the orders mailbox once one is connected (prototype: MAIL0): the first
 * three files of the sample set (src/sample/sample-pos.json, served from public/samples/), with
 * the prototype's invented senders, subjects and times. Sizes are the files' own.
 */
import SAMPLE_POS from "./sample-pos.json";
import type { MailItem } from "./types";

const [hh2240, pk331, hh2231] = SAMPLE_POS.files;

export const MAIL0: readonly MailItem[] = [
  { from: "Harbour Hotel · purchasing", subj: "PO HH-2240", file: hh2240, at: "11:32", size: 4805 },
  { from: "Pavilion Kitchen", subj: "Order for Monday", file: pk331, at: "11:20", size: 4288 },
  { from: "Harbour Hotel · purchasing", subj: "Fwd: PO HH-2231", file: hh2231, at: "10:58", size: 6001 },
];

/** The example "Try an example" pastes into Add orders. */
export const PASTE_EXAMPLE = "Hi, order for Mon pls\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red x1\nthanks!";
