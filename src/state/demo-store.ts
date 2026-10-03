/*
 * The demo's client store. Everything the prototype kept in one localStorage key lives here,
 * behind get / update / reset, so it can be swapped for server data later without touching pages.
 */
"use client";

import { useSyncExternalStore } from "react";
import { seed } from "@/sample";
import type { DemoState, Person } from "@/sample";
import { visibleOrders } from "@/platform/access";

const KEY = "pot-demo-v1";
const SERVER: DemoState = seed();

let state: DemoState | null = null;
const listeners = new Set<() => void>();

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    /* storage blocked or corrupt: fall back to the seed */
  }
  return seed();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getState(): DemoState {
  if (typeof window === "undefined") return SERVER;
  if (!state) state = load();
  return state;
}

/** Apply a change to a copy of the state, persist it and notify subscribers. */
export function update(fn: (draft: DemoState) => void) {
  const next = structuredClone(getState());
  fn(next);
  state = next;
  save();
  emit();
}

/** "Reset demo data": back to the invented seed. */
export function reset() {
  state = seed();
  save();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDemo(): DemoState {
  return useSyncExternalStore(subscribe, getState, () => SERVER);
}

/** The person working now. Later: read from the signed session on the server. */
export const meOf = (s: DemoState): Person => s.people.find((p) => p.id === s.user) || s.people[0];

export function useMe(): Person {
  return meOf(useDemo());
}

export function useVisibleOrders() {
  const s = useDemo();
  return visibleOrders(s.orders, meOf(s));
}
