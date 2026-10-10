"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useInvoices } from "@/checker/api";
import { summarize } from "@/checker/summary";
import { canEdit, navAllowed, needsPin, visibleOrders } from "@/platform/access";
import { NAV, navKeyOf } from "@/platform/nav";
import { GROUP_LOGIN, ROLES } from "@/sample";
import { meOf, reset, useDemo } from "@/state/demo-store";
import { pick } from "@/state/session";
import { currentTheme, toggleTheme, type Theme } from "@/state/theme";
import { initials } from "@/lib/format";
import { useShell } from "./context";

/** The side rail: static brand, nav with counts, the PO assistant item, Ask, and the profile pill with its upward menu. */
export function Rail({ open }: { open: boolean }) {
  const s = useDemo();
  const u = meOf(s);
  const pathname = usePathname();
  const router = useRouter();
  const shell = useShell();
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const mine = visibleOrders(s.orders, u);
  const { invoices } = useInvoices();
  const route = navKeyOf(pathname);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  const count = (key: string): number => {
    if (key === "orders") return mine.filter((o) => o.state !== "delivered").length;
    if (key === "invoices") return invoices ? summarize(invoices).piles.look.length : 0;
    return 0;
  };

  const go = (href: string) => {
    setMenu(false);
    router.push(href);
  };

  // The prototype's askWho(): Owner and Finance confirm with a PIN when someone else switches to them.
  const askWho = (id: string) => {
    setMenu(false);
    const p = s.people.find((x) => x.id === id);
    if (p && needsPin(p) && id !== s.user) router.push(`/who?pin=${id}`);
    else {
      pick(id);
      router.push("/home");
    }
  };

  const own = u.role === "owner";

  return (
    <aside className={`rail${open ? " open" : ""}`} id="rail">
      <div className="acct brand">
        <span className="av">EG</span>
        <span style={{ minWidth: 0 }}>
          <b>PO Tracker</b>
          <small>Edible Garden City</small>
        </span>
      </div>
      <nav className="nav" id="nav" aria-label="Sections">
        {NAV.filter((n) => navAllowed(n.key, u)).map((n) => {
          const c = count(n.key);
          const dot = n.key === "home" && canEdit(u) && s.toCheck.length > 0;
          return (
            <Link key={n.key} href={n.href} className={route === n.key ? "on" : ""}>
              <Icon name={n.icon} />
              {n.label}
              {c ? <span className="cnt">{c}</span> : dot ? <span className="dot" title="Waiting on you" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="sec">Agent</div>
      <nav className="nav" style={{ marginTop: 0 }}>
        <a
          href="#agent"
          onClick={(e) => {
            e.preventDefault();
            shell.openAgent(true);
          }}
        >
          <Icon name="spark" />
          PO assistant<span className="cnt">{s.chat.length ? s.chat.length : ""}</span>
        </a>
      </nav>
      <div className="railfoot">
        <button className="askbtn" onClick={() => shell.openAgent(!shell.agentOpen)}>
          <Icon name="spark2" />
          Ask <kbd>⌘I</kbd>
        </button>
        <div className="me">
          <button
            ref={btnRef}
            className="mebtn"
            aria-haspopup="true"
            aria-expanded={menu}
            onClick={() => {
              setTheme(currentTheme());
              setMenu(!menu);
            }}
          >
            <span className="av">{initials(u.name)}</span>
            <span>{u.name}</span>
            <Icon name="chevUp" />
          </button>
          <span className="sp" />
          <button className="ib" title="Search (⌘K)" aria-label="Search" onClick={() => shell.openPalette(true)}>
            <Icon name="searchSm" />
          </button>
        </div>
        {menu ? (
          <div className="pop up" ref={popRef}>
            <div className="ph">{GROUP_LOGIN}</div>
            {s.people.map((p) => (
              <button key={p.id} onClick={() => askWho(p.id)}>
                <span className="tick">{p.id === s.user ? <Icon name="check" /> : null}</span>
                <span className="av2">{initials(p.name)}</span>
                {p.name}
                <small>{ROLES[p.role]}</small>
              </button>
            ))}
            {own ? (
              <>
                <hr />
                <button onClick={() => go("/settings/connections")}>
                  <Icon name="mail" />
                  Connections
                </button>
                <button onClick={() => go("/people")}>
                  <Icon name="people" />
                  People
                </button>
                <button onClick={() => go("/settings/lists")}>
                  <Icon name="gear" />
                  Settings
                </button>
              </>
            ) : null}
            <hr />
            <button
              onClick={() => {
                setMenu(false);
                shell.openPalette(true);
              }}
            >
              <Icon name="search" />
              Search<small>⌘K</small>
            </button>
            <button
              onClick={() => {
                setMenu(false);
                shell.openAgent(true);
              }}
            >
              <Icon name="spark" />
              Ask the assistant<small>⌘I</small>
            </button>
            <button onClick={() => setTheme(toggleTheme())}>
              <Icon name="eye" />
              Appearance<small>{theme === "light" ? "Light" : "Dark"}</small>
            </button>
            <hr />
            <button
              onClick={() => {
                setMenu(false);
                reset();
                router.push("/home");
                shell.toast("Demo reset");
              }}
            >
              <Icon name="clock" />
              Reset demo data
            </button>
            <button onClick={() => go("/who")}>Switch person</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
