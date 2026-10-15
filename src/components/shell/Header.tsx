"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { useShell } from "./context";

/** The prototype's hd(): 56px sticky header with the mobile menu button, page icon, crumbs and actions. */
export function Header({ icon, acts, className, children }: { icon?: IconName; acts?: ReactNode; className?: string; children: ReactNode }) {
  const { toggleRail } = useShell();
  return (
    <header className={className ? `hd ${className}` : "hd"}>
      <button className="ib menu" onClick={toggleRail} aria-label="Menu">
        <Icon name="menu" />
      </button>
      <h1>
        {icon ? <Icon name={icon} /> : null}
        {children}
      </h1>
      <div className="acts">{acts}</div>
    </header>
  );
}
