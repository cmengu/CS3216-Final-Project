"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShell } from "./context";

/**
 * Puts its children in the shell's side pane (the prototype's PANE beside the page) for as long
 * as the page is shown. The shell owns the <aside class="pane"> and the main's withpane class.
 */
export function SidePane({ children }: { children: ReactNode }) {
  const { paneHost, setPane } = useShell();
  useEffect(() => {
    setPane("on");
    return () => setPane("off");
  }, [setPane]);
  return paneHost ? createPortal(children, paneHost) : null;
}
