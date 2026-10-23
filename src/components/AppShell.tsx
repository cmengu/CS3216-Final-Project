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
import { useUploads } from "@/checker/uploads";
import { useMasterList, useMasterListError, refreshMasterList, type MasterList } from "@/masterList";
import { Icon } from "./icons";

/**
 * first: no master list yet. setup: a master list, no invoices yet. ready: setup is complete.
 * loading: the invoice list hasn't answered yet.
 */
export type Phase = "first" | "setup" | "ready" | "loading";

interface AppState {
  user: User;
  masterList: MasterList | null;
  invoices: SupplierInvoice[] | null;
  invoiceError: string | null;
  phase: Phase;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppShell");
  return v;
}

function phaseOf(ml: MasterList | null, invoices: SupplierInvoice[] | null, error: string | null): Phase {
  if (!ml) return "first";
  if (invoices === null) return error ? "ready" : "loading";
  return invoices.length ? "ready" : "setup";
}

function Switcher({ phase, toDecide }: { phase: Phase; toDecide: number }) {
  const path = usePathname();
  const locked = phase === "first";
  const tab = (href: string, icon: "list" | "sheet" | "clock", label: string, extra?: ReactNode) => {
    const current = path.startsWith(href);
    if (locked && href !== "/master-list")
      return (
        <button type="button" aria-disabled="true" title="Upload your master list first">
          <Icon name={icon} size="ui" />
          {label}
        </button>
      );
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
        phase !== "first" ? (
          <span className="ok">
            <Icon name="tick" style={{ strokeWidth: 2 }} />
            <span className="sr">ready</span>
          </span>
        ) : null,
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

function Stepper({ checking }: { checking: boolean }) {
  return (
    <nav className="ic-steps" aria-label="Setup">
      <Link className="ic-step done" href="/master-list">
        <span className="num">
          <Icon name="tick" />
        </span>
        Master list
        <span className="sr">(done)</span>
      </Link>
      <span className="ic-step-sep" aria-hidden="true" />
      {checking ? (
        <span className="ic-step done">
          <span className="num">
            <Icon name="tick" />
          </span>
          Upload invoices
        </span>
      ) : (
        <Link className="ic-step" href="/invoices" aria-current="step">
          <span className="num">2</span>Upload invoices
        </Link>
      )}
      <span className="ic-step-sep" aria-hidden="true" />
      <span className="ic-step" aria-current={checking ? "step" : undefined} aria-disabled={checking ? undefined : "true"}>
        <span className="num">3</span>Check
      </span>
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
            href="/invoices?outlook=1"
            onClick={() => setOpen(false)}
          >
            <Icon name="mail" size="ui" />
            Outlook inbox
          </Link>
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
  const ml = useMasterList();
  const masterError = useMasterListError();
  const router = useRouter();
  const { invoices, error } = useInvoices();
  const uploads = useUploads();

  useEffect(() => {
    if (user === null) router.replace("/sign-in");
  }, [user, router]);

  if (!user) return null;
  if (masterError) return <div className="ic-page"><p role="alert">{masterError}</p><button className="ic-btn" onClick={() => void refreshMasterList()}>Retry</button></div>;
  if (ml === undefined) return <p className="ic-empty">Loading master list…</p>;

  const phase = phaseOf(ml, invoices, error);
  const toDecide = invoices ? summarize(invoices).piles.decide.length : 0;

  return (
    <Ctx.Provider value={{ user, masterList: ml, invoices, invoiceError: error, phase }}>
      <div className="ic-app">
        <header className="ic-top">
          <Link className="ic-brand" href="/">
            <span className="ic-mark" aria-hidden="true">
              <Icon name="tick" size="ui" />
            </span>
            Invoice Checker
          </Link>
          {phase === "setup" ? <Stepper checking={uploads.items.length > 0} /> : <Switcher phase={phase} toDecide={toDecide} />}
          <Account user={user} />
        </header>
        <main className="ic-main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
