"use client";

/*
 * The pages that are built in later tasks: each has its real header (icon, crumbs, title as the
 * prototype's hd() calls draw them) and an empty body, so navigation works end to end.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { canEdit, navAllowed, seesCustomer, type NavKey } from "@/platform/access";
import { SETTINGS_PANES } from "@/platform/nav";
import { meOf, useDemo, useMe } from "@/state/demo-store";
import { ref } from "@/lib/format";

/** Routes a role may not open fall back to Home, as the prototype's router does. */
export function RequireNav({ nav, children }: { nav: NavKey; children: ReactNode }) {
  const u = useMe();
  const router = useRouter();
  const ok = navAllowed(nav, u);
  useEffect(() => {
    if (!ok) router.replace("/home");
  }, [ok, router]);
  return ok ? children : null;
}

const NotFound = () => (
  <>
    <Header>Not found</Header>
    <div className="body">
      <div className="hint">No such order in your view.</div>
    </div>
  </>
);

export function OrdersStub() {
  const u = useMe();
  return (
    <>
      <Header
        icon="list"
        acts={
          canEdit(u) ? (
            <Link className="btn p s" href="/add">
              <Icon name="plus" />
              Add
            </Link>
          ) : null
        }
      >
        Orders
      </Header>
      <div className="body" />
    </>
  );
}

export function OrderStub({ id }: { id: string }) {
  const s = useDemo();
  const u = meOf(s);
  const o = s.orders.find((x) => x.id === id);
  if (!o || !seesCustomer(u, o.cust)) return <NotFound />;
  return (
    <>
      <Header>
        <Link className="crumb" href="/orders">
          Orders
        </Link>
        <span className="sep">›</span>
        <span className="mono" style={{ fontSize: 13 }}>
          {ref(o)}
        </span>
      </Header>
      <div className="body" />
    </>
  );
}

export function CustomersStub() {
  return (
    <>
      <Header icon="building">Customers</Header>
      <div className="body" />
    </>
  );
}

export function CustomerStub({ id }: { id: string }) {
  const s = useDemo();
  const u = meOf(s);
  const c = s.customers[id];
  if (!c || !seesCustomer(u, id)) return <Header>Not found</Header>;
  return (
    <>
      <Header>
        <Link className="crumb" href="/customers">
          Customers
        </Link>
        <span className="sep">›</span>
        {c.name}
      </Header>
      <div className="body" />
    </>
  );
}

export function PlainStub({ title }: { title: string }) {
  return (
    <>
      <Header>{title}</Header>
      <div className="body" />
    </>
  );
}

export function SettingsStub({ pane }: { pane: string }) {
  const s = useDemo();
  const tab = SETTINGS_PANES.find((t) => t[0] === pane) ?? SETTINGS_PANES[0];
  const prop = s.aliases.filter((a) => a.state === "proposed").length;
  const on = (s.cx.mail ? 1 : 0) + (s.cx.paste ? 1 : 0) + (s.cx.wa === "pending" ? 1 : 0);
  return (
    <>
      <Header>Settings</Header>
      <div className="setwrap">
        <nav className="setnav">
          {SETTINGS_PANES.map(([k, l]) => (
            <Link key={k} href={`/settings/${k}`} className={k === tab[0] ? "on" : ""}>
              {l}
              {k === "aliases" && prop ? <span className="cnt">{prop} to approve</span> : null}
              {k === "connections" ? <span className="cnt">{on} of 3 on</span> : null}
            </Link>
          ))}
        </nav>
        <div className="setpane">
          <h2>{tab[1]}</h2>
        </div>
      </div>
    </>
  );
}
