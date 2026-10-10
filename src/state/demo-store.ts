/*
 * The demo's client store. Everything the prototype kept in one localStorage key lives here,
 * behind get / update / reset, so it can be swapped for server data later without touching pages.
 */
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { seed } from "@/sample";
import type { DemoState, Person } from "@/sample";
import { visibleOrders } from "@/platform/access";

const KEY = "pot-demo-v3";
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

export interface UpdateOptions {
  /**
   * A change the prototype makes without redrawing the page (the assistant's answers and its
   * "Asked" event, thumbs, a new conversation, the "Viewed prices" it logs while drawing an order).
   * The page shows such events from its next redraw on; see useShownEvents().
   */
  quiet?: boolean;
  /** Notify subscribers even when nothing changed (picking the same person again). */
  force?: boolean;
}

let quiet = false;
/** Whether the change being announced is a quiet one. */
export const isQuietUpdate = () => quiet;

/**
 * Apply a change to a copy of the state, persist it and notify subscribers. A change that changes
 * nothing (an action refused with a toast) notifies no one, as the prototype then draws nothing.
 */
export function update(fn: (draft: DemoState) => void, opts: UpdateOptions = {}) {
  const prev = getState();
  const next = structuredClone(prev);
  fn(next);
  if (!opts.force && JSON.stringify(next) === JSON.stringify(prev)) return;
  state = next;
  save();
  quiet = !!opts.quiet;
  try {
    emit();
  } finally {
    quiet = false;
  }
}

/**
 * The events as the page last drew them: everything there was when the page opened, and
 * everything after each change that redraws the page. Events added by a quiet change (the
 * assistant's "Asked", the "Viewed prices" logged on opening an order) show from the next
 * redraw on, as in the prototype.
 */
export function useShownEvents() {
  const s = useDemo();
  const [n, setN] = useState(() => s.events.length);
  useEffect(
    () =>
      subscribe(() => {
        if (!isQuietUpdate()) setN(getState().events.length);
      }),
    [],
  );
  return s.events.slice(0, n);
}

/**
 * The state as the page last drew it: as it was when the page opened, then after each change
 * that redraws the page. A quiet change (one saved without redrawing) shows from the next redraw on.
 */
export function useDrawnState(): DemoState {
  const live = useDemo();
  const [drawn, setDrawn] = useState(live);
  useEffect(
    () =>
      subscribe(() => {
        if (!isQuietUpdate()) setDrawn(getState());
      }),
    [],
  );
  return drawn;
}

/** "Reset demo data": back to the invented seed. */
export function reset() {
  state = seed();
  save();
  emit();
}

/** Called after every change to the demo state. Returns the unsubscribe function. */
export function subscribe(l: () => void) {
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
