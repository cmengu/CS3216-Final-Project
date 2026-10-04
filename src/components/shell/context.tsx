"use client";

import { createContext, useContext } from "react";

/**
 * Open the assistant for some orders. One order scopes the conversation to it (the context tag,
 * as the order page's Ask does); several prefill "Summarise <refs>" (as the bulk bar's Ask does).
 * `prompt` prefills the composer instead; `send` asks it straight away.
 */
export interface AssistantRequest {
  orderIds?: string[];
  prompt?: string;
  send?: boolean;
}

export interface ShellApi {
  toast: (text: string) => void;
  copyText: (text: string, msg?: string) => void;
  openAgent: (open: boolean, prefill?: string) => void;
  openAssistant: (req?: AssistantRequest) => void;
  agentOpen: boolean;
  openPalette: (open: boolean) => void;
  toggleRail: () => void;
  /** The side pane beside the page (the order page's customer pane); null while no page has one. */
  paneHost: HTMLElement | null;
  /** "on" shows the pane in its column, "hidden" drops the column (the pane's Hide), "off" removes it. */
  setPane: (state: PaneState) => void;
  /**
   * What Esc does on the page before it closes the assistant (Orders: clear the selection).
   * The handler returns true when it acted. Null removes it.
   */
  setEscape: (fn: (() => boolean) | null) => void;
}

export type PaneState = "off" | "on" | "hidden";

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error("useShell outside the app shell");
  return api;
}
