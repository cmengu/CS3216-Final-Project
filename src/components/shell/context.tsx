"use client";

import { createContext, useContext } from "react";

export interface ShellApi {
  toast: (text: string) => void;
  copyText: (text: string, msg?: string) => void;
  openAgent: (open: boolean, prefill?: string) => void;
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
