/*
 * "Who's working?" as client demo state. The prototype remembers the pick per browser session
 * (sessionStorage 'pot-who') and the person in the demo state. Later a signed session cookie,
 * read by src/platform/access.ts on the server, replaces this file.
 */
"use client";

import { useSyncExternalStore } from "react";
import { update } from "./demo-store";

const WHO = "pot-who";
let greetPending = true;

export function isPicked(): boolean {
  try {
    return !!sessionStorage.getItem(WHO);
  } catch {
    return false;
  }
}

/** Pick a person: they become the one working, for this browser session. */
export function pick(personId: string) {
  update((s) => {
    s.user = personId;
  });
  try {
    sessionStorage.setItem(WHO, "1");
  } catch {
    /* ignore */
  }
  greetPending = true;
}

/** Home says "Hi <name>" once per page load and once after each pick. */
export const shouldGreet = () => greetPending;
export const markGreeted = () => {
  greetPending = false;
};

const noop = () => () => {};
/** False during server render and hydration, true once running in the browser. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
