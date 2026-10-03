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
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error("useShell outside the app shell");
  return api;
}
