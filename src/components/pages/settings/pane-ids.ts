/* The Settings pane ids, usable from the server route as well as the client view. */
import { SETTINGS_PANES } from "@/platform/nav";

export type PaneId = (typeof SETTINGS_PANES)[number][0];

export const isPaneId = (p: string): p is PaneId => SETTINGS_PANES.some((t) => t[0] === p);
