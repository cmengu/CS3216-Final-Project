"use client";

/*
 * The app frame: a 56px top bar (brand, the Master list / Invoices / Audit trail switcher or the
 * setup stepper, the account menu) over one page. Sends anyone signed out to /sign-in.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { signOut, useUser, type User } from "@/auth";
import { useInvoices } from "@/checker/api";
import { summarize } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { useProjects, type Project } from "@/checker/projects";
import { Icon } from "./icons";

/**
 * first: no master list yet. setup: a master list, no invoices yet. ready: setup is complete.
 * loading: the invoice list hasn't answered yet.
 */
export type Phase = "first" | "setup" | "ready" | "loading";

interface AppState {
  user: User;
  invoices: SupplierInvoice[] | null;
  invoiceError: string | null;
  phase: Phase;
  projects: Project[];
  projectError: string | null;
  projectsLoading: boolean;
  reloadProjects: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppShell");
  return v;
}

function Switcher({ toDecide }: { toDecide: number }) {
  const path = usePathname();
  const tab = (href: string, icon: "list" | "sheet" | "clock", label: string, extra?: ReactNode) => {
    const current = path.startsWith(href);
    return (
      <Link href={href} aria-current={current ? "page" : undefined}>
        <Icon name={icon} size="ui" />
        {label}
        {extra}
      </Link>
    );
  };
  return (
    <nav className="ic-seg" aria-label="Workspace">
      {tab(
        "/master-list",
        "list",
        "Master list",

      )}
      {tab(
        "/invoices",
        "sheet",
        "Invoices",
        toDecide ? (
          <>
            <span className="ic-pill ic-pill--warn">{toDecide}</span>
            <span className="sr"> to decide</span>
          </>
        ) : null,
      )}
      {tab("/audit", "clock", "Audit trail")}
    </nav>
  );
}

function Account({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="ic-acctwrap" ref={wrap}>
      <button ref={button} className="ic-acct" type="button" aria-label="Account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="ic-av" aria-hidden="true">
          {user.email.charAt(0).toUpperCase()}
        </span>
        <Icon name="chevDown" />
      </button>
      {open ? (
        <div className="ic-menu" role="menu" aria-label="Account">
          <div className="who muted">
            Signed in as <b style={{ color: "var(--ink)", fontWeight: 600 }}>{user.email}</b>
          </div>
          <Link
            role="menuitem"
            href="/master-list?replace=1"
            onClick={() => setOpen(false)}
          >
            <Icon name="upload" size="ui" />
            Replace master list
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.replace("/sign-in");
            }}
          >
            <Icon name="signout" size="ui" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const projectState = useProjects();
  const reloadProjects = projectState.reload;
  const router = useRouter();
  const { invoices, error } = useInvoices();


  useEffect(() => {
    if (user) reloadProjects();
  }, [user, invoices, reloadProjects]);

  useEffect(() => {
    if (user === null) router.replace("/sign-in");
  }, [user, router]);

  if (!user) return null;
  const phase: Phase = invoices === null && !error ? "loading" : "ready";
  const toDecide = invoices ? summarize(invoices.filter((i) => i.comparisonMode !== "totals_only")).piles.decide.length : 0;

  return (
    <Ctx.Provider value={{ user, invoices, invoiceError: error, phase, projects: projectState.projects, projectError: projectState.error, projectsLoading: projectState.loading, reloadProjects: projectState.reload }}>
      <div className="ic-app">
        <header className="ic-top">
          <Link className="ic-brand" href="/">
            <span className="ic-mark" aria-hidden="true">
              <Icon name="tick" size="ui" />
            </span>
            Invoice Checker
          </Link>
          <Switcher toDecide={toDecide} />
          <Account user={user} />
        </header>
        <main className="ic-main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
