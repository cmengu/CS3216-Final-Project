"use client";

/*
 * The core app frame while InvoiceTracker is cut back to master list, invoices and the check:
 * no sidebar, no assistant, no ⌘K palette. It keeps the ShellApi contract (toasts, copy, Esc,
 * the side-pane host) so the core pages and the parked ones both compile against it.
 * The full frame with the rail, assistant and palette is parked at
 * src/_parked/components/shell/AppShell.tsx (see src/_parked/README.md).
 * Sends anyone who has not picked a person this session to /who.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isQuietUpdate, subscribe } from "@/state/demo-store";
import { isPicked, useMounted } from "@/state/session";
import { RouteGuard } from "./Guard";
import { ShellContext, type PaneState, type ShellApi } from "./context";

/** The parked features answer with this, so a stray call is visible rather than silent. */
const PARKED = "Not available in this version";

export function AppShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();
  const picked = mounted && isPicked();

  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mainRef = useRef<HTMLElement>(null);
  const escRef = useRef<(() => boolean) | null>(null);
  const [pane, setPane] = useState<PaneState>("off");
  const [paneHost, setPaneHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (mounted && !isPicked()) router.replace("/who");
  }, [mounted, pathname, router]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // A change that redraws the page puts it back at the top, as the full frame does.
  useEffect(
    () =>
      subscribe(() => {
        if (!isQuietUpdate()) mainRef.current?.scrollTo({ top: 0 });
      }),
    [],
  );

  const toast = useCallback((t: string) => {
    setToastText(t);
    setToastOn(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), 2200);
  }, []);

  const api: ShellApi = useMemo(
    () => ({
      toast,
      copyText: (t, msg) => {
        try {
          navigator.clipboard.writeText(t).then(
            () => toast(msg || "Copied"),
            () => toast(msg || "Copied"),
          );
        } catch {
          toast(msg || "Copied");
        }
      },
      openAgent: () => toast(PARKED),
      openAssistant: () => toast(PARKED),
      agentOpen: false,
      openPalette: () => toast(PARKED),
      toggleRail: () => {},
      paneHost,
      setPane,
      setEscape: (fn) => {
        escRef.current = fn;
      },
    }),
    [toast, paneHost],
  );

  // Esc goes to the page's own handler (an invoice page goes back to the list).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!picked) return null;

  return (
    <ShellContext.Provider value={api}>
      <div className="app norail" id="app">
        <main className={`main${pane === "on" ? " withpane" : ""}`} id="main" ref={mainRef}>
          <div className="content">
            <RouteGuard>{children}</RouteGuard>
          </div>
          {pane !== "off" ? <aside className="pane" ref={setPaneHost} /> : null}
        </main>
      </div>
      <div className={`toast${toastOn ? " on" : ""}`} role="status" aria-live="polite">
        {toastText}
      </div>
    </ShellContext.Provider>
  );
}
