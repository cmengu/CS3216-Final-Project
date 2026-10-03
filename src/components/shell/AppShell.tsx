"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isPicked, useMounted } from "@/state/session";
import { Agent } from "./Agent";
import { ShellContext, type ShellApi } from "./context";
import { Kbar } from "./Kbar";
import { Palette } from "./Palette";
import { Rail } from "./Rail";

const AGENT_W = "pot-agentw";
const LIST_ROUTES = ["/orders", "/invoices", "/customers"];

/**
 * The app frame: rail · assistant column · main (page + keyboard bar), plus the ⌘K palette and toasts.
 * Sends anyone who has not picked a person this session to /who.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();
  const picked = mounted && isPicked();

  const [agentOpen, setAgentOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const [pal, setPal] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [agentW, setAgentW] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(AGENT_W);
    } catch {
      return null;
    }
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mainRef = useRef<HTMLElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  // A new page: close the mobile rail (state adjusted during render, as React recommends).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setRailOpen(false);
  }

  useEffect(() => {
    if (mounted && !isPicked()) router.replace("/who");
  }, [mounted, pathname, router]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

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
      openAgent: (open, text) => {
        setAgentOpen(open);
        if (text) setPrefill(text);
      },
      agentOpen,
      openPalette: setPal,
      toggleRail: () => setRailOpen((v) => !v),
    }),
    [toast, agentOpen],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "i") {
        e.preventDefault();
        setAgentOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setPal((v) => !v);
      }
      if (e.key === "Escape") {
        if (pal) setPal(false);
        else setAgentOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pal]);

  if (!picked) return null;

  const style = agentW ? ({ "--agentw": agentW } as CSSProperties) : undefined;

  return (
    <ShellContext.Provider value={api}>
      <div className={`app${agentOpen ? " agent-open" : ""}`} id="app" style={style}>
        <Rail open={railOpen} />
        <main className="main" id="main" ref={mainRef}>
          <div className="content">
            {children}
            <Kbar kind={LIST_ROUTES.includes(pathname) ? "list" : "page"} />
          </div>
        </main>
        <Agent
          prefill={prefill}
          onResize={(w, done) => {
            setAgentW(w + "px");
            if (done) {
              try {
                localStorage.setItem(AGENT_W, w + "px");
              } catch {
                /* ignore */
              }
            }
          }}
        />
      </div>
      <Palette open={pal} />
      <div className={`toast${toastOn ? " on" : ""}`} role="status" aria-live="polite">
        {toastText}
      </div>
    </ShellContext.Provider>
  );
}
