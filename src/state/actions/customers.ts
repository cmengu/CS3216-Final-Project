/* Customer actions, as the prototype's addNote(). Each has a pure apply step (tested) and a store call. */
"use client";

import { TODAY } from "@/sample";
import type { DemoState } from "@/sample";
import { canEdit } from "@/platform/access";
import { meOf, update } from "@/state/demo-store";

/** The demo's clock: the fixed TODAY with the real time of day, as the prototype's nowStr(). */
export const nowStr = (d: Date = new Date()) =>
  TODAY + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

/** Add a standing note to a customer and write the history entry. Owner and coordinator only; false for an empty note. */
export function applyAddNote(s: DemoState, customerId: string, text: string, at: string = nowStr()): boolean {
  const v = text.trim();
  const c = s.customers[customerId];
  if (!v || !c || !canEdit(meOf(s))) return false;
  c.notes.push(v);
  s.history.push({ at, who: meOf(s).name, kind: "note_added", order: null, text: `Standing note on ${c.name}` });
  return true;
}

export function addNote(customerId: string, text: string): boolean {
  let ok = false;
  update((s) => {
    ok = applyAddNote(s, customerId, text);
  });
  return ok;
}
