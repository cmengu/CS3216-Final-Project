"use client";

/*
 * The app frame: a 56px top bar (brand, the Master list / Invoices / Audit trail switcher or the
 * setup stepper, the account menu) over one page. Sends anyone signed out to /sign-in.
 */
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { refreshAuthSession, signOut, useSessionError, useUser, type User } from "@/auth";
import { useInvoices } from "@/checker/api";
import { summarize } from "@/checker/summary";
import type { SupplierInvoice } from "@/checker/types";
import { useProjects, type Project } from "@/checker/projects";
import { findGroup, groupUrl } from "@/checker/group-url";
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
  const params = useSearchParams();
  const { projects, invoices } = useApp();
  const linked = invoices?.find(i => i.id === params.get("id"));
  const project = params.get("view") === "projects" || params.get("pick") === "1" ? undefined
    : findGroup(projects, params) ?? (params.has("group") || params.has("project") ? undefined
      : projects.find(p => p.id === linked?.projectId)
        ?? (path === "/invoices" ? projects.find(p => p.id.startsWith("legacy:")) ?? projects[0]
          : projects.filter(p => p.comparison_mode === "master_list").length === 1
            ? projects.find(p => p.comparison_mode === "master_list") : undefined));
  const tab = (href: string, icon: "list" | "sheet" | "clock", label: string, extra?: ReactNode) => {
    const current = path.startsWith(href);
    return (
      <Link href={project && (href === "/invoices" || href === "/master-list") ? groupUrl(href, project) : href} aria-current={current ? "page" : undefined}>
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
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
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
          {user.role === "admin" ? <Link role="menuitem" href="/admin/accounts" onClick={() => setOpen(false)}>Approved accounts</Link> : null}
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)}>Change password</Link>
          <button
            role="menuitem"
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSignOutError(null);
              setSigningOut(true);
              try {
                await signOut();
                router.replace("/sign-in");
              } catch (error) {
                setSignOutError(error instanceof Error ? error.message : "Couldn’t sign out. Try again.");
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <Icon name="signout" size="ui" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {signOutError ? <p role="alert" className="who">{signOutError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const sessionError = useSessionError();
  const router = useRouter();

  useEffect(() => {
    if (user === null) router.replace("/sign-in");
  }, [user, router]);

  if (!user) return <div className="ic-auth">
    <Brand />
    <main className="ic-card" aria-busy={!sessionError}>
      <h1>{sessionError ? "Couldn’t check your session" : "Checking your session…"}</h1>
      {sessionError ? <>
        <p className="ic-hint" role="alert">{sessionError}</p>
        <button type="button" className="ic-btn ic-btn--primary" onClick={() => { void refreshAuthSession(); }}>Try again</button>
      </> : <p className="ic-hint">Waiting for the service to confirm your sign-in.</p>}
    </main>
  </div>;
  return <SignedInShell user={user}>{children}</SignedInShell>;
}

function SignedInShell({ user, children }: { user: User; children: ReactNode }) {
  const projectState = useProjects();
  const reloadProjects = projectState.reload;
  const { invoices, error } = useInvoices();

  useEffect(() => {
    reloadProjects();
  }, [invoices, reloadProjects]);

  const phase: Phase = invoices === null && !error ? "loading" : "ready";
  const toDecide = invoices ? summarize(invoices.filter((i) => i.comparisonMode !== "totals_only")).piles.decide.length : 0;

  return (
    <Ctx.Provider value={{ user, invoices, invoiceError: error, phase, projects: projectState.projects, projectError: projectState.error, projectsLoading: projectState.loading, reloadProjects: projectState.reload }}>
      <div className="ic-app">
        <header className="ic-top">
          <Brand />
          <Suspense fallback={null}><Switcher toDecide={toDecide} /></Suspense>
          <Account user={user} />
        </header>
        <main className="ic-main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
