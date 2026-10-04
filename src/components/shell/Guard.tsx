"use client";

/*
 * One rule for pages a person may not open, as the prototype's router has it: the route draws
 * Home instead (the address stays as it is). The shell wraps every route in RouteGuard. Pages
 * for one record (an order, a customer) show the prototype's Not found when the record is
 * missing or outside this person's view.
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { HomeView } from "@/components/pages/HomeView";
import { navAllowed } from "@/platform/access";
import { navKeyOf } from "@/platform/nav";
import { useMe } from "@/state/demo-store";
import { Header } from "./Header";

/** The prototype's hd('Not found'), with its hint line where the prototype has one. */
export function NotFound({ hint }: { hint?: string }) {
  return (
    <>
      <Header>Not found</Header>
      {hint ? (
        <div className="body">
          <div className="hint">{hint}</div>
        </div>
      ) : null}
    </>
  );
}

/** Whether this person's role may open the current route. */
export function useRouteAllowed(): boolean {
  const u = useMe();
  const key = navKeyOf(usePathname());
  return !key || navAllowed(key, u);
}

/** Renders the route when this person's role may open it; otherwise Home, as the prototype does. */
export function RouteGuard({ children }: { children: ReactNode }) {
  return useRouteAllowed() ? children : <HomeView />;
}
