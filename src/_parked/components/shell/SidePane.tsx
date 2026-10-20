"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isQuietUpdate, subscribe } from "@/state/demo-store";
import { useShell } from "@/components/shell/context";

/**
 * Puts its children in the shell's side pane (the prototype's PANE beside the page) for as long
 * as the page is shown. The shell owns the <aside class="pane"> and the main's withpane class.
 */
export function SidePane({ children }: { children: ReactNode }) {
  const { paneHost, setPane } = useShell();
  useEffect(() => {
    setPane("on");
    // The pane's Hide lasts until the page is drawn again: any change that redraws the page brings it back.
    const off = subscribe(() => {
      if (!isQuietUpdate()) setPane("on");
    });
    return () => {
      off();
      setPane("off");
    };
  }, [setPane]);
  return paneHost ? createPortal(children, paneHost) : null;
}
