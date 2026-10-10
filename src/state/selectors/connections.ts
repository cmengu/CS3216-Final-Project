/*
 * Read-only views of the connection state (prototype: conn(), connOn(), mailbox()).
 * Settings › Connections writes it and reads it through these.
 */
import type { Connections, DemoState, MailItem } from "@/sample";
import { mailbox } from "@/platform/nav";

const OFF: Connections = { mail: null, mailFlow: null, paste: false, wa: null };

/** The connection state, all off when it was never set. */
export const conn = (s: Pick<DemoState, "cx">): Connections => s.cx ?? OFF;

/** The orders mailbox is connected (Outlook or Gmail). */
export const mailboxOn = (s: Pick<DemoState, "cx">): boolean => !!conn(s).mail;

/** WhatsApp paste and chat export is turned on. */
export const pasteOn = (s: Pick<DemoState, "cx">): boolean => conn(s).paste;

/** "WhatsApp, live on your number" has been linked and sent to Meta for review. */
export const waLiveOn = (s: Pick<DemoState, "cx">): boolean => conn(s).wa === "pending";

/** How many of the three connections are on (the Settings menu's "N of 3 on"). */
export const connOn = (s: Pick<DemoState, "cx">): number => (mailboxOn(s) ? 1 : 0) + (pasteOn(s) ? 1 : 0) + (waLiveOn(s) ? 1 : 0);

/** New PDFs waiting in the orders mailbox; empty while it is not connected. */
export const mailboxFiles = (s: DemoState): MailItem[] => mailbox(s);
