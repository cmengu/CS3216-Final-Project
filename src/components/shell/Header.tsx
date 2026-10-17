"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { useShell } from "./context";

/** The prototype's hd(): 56px sticky header with the mobile menu button, page icon, crumbs and actions. */
export function Header({
  icon,
  acts,
  className,
  title = "h1",
  children,
}: {
  icon?: IconName;
  acts?: ReactNode;
  className?: string;
  /** "div" when the page draws its own h1 (Home's welcome line). */
  title?: "h1" | "div";
  children: ReactNode;
}) {
  const { toggleRail } = useShell();
  const Title = title;
  return (
    <header className={className ? `hd ${className}` : "hd"}>
      <button className="ib menu" onClick={toggleRail} aria-label="Menu">
        <Icon name="menu" />
      </button>
      <Title className={title === "div" ? "hdt" : undefined}>
        {icon ? <Icon name={icon} /> : null}
        {children}
      </Title>
      <div className="acts">{acts}</div>
    </header>
  );
}
