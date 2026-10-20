"use client";

/* Settings (owner only): one heading, horizontal pane navigation, and a full-width pane. */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Header } from "@/components/shell/Header";
import { SETTINGS_PANES } from "@/platform/nav";
import { useDemo } from "@/state/demo-store";
import { connOn } from "@/state/selectors/connections";
import { AliasesPane, AssistantPane, ListsPane, RetentionPane } from "./Panes";
import { ConnectionsPane } from "./Connections";
import { RepliesPane } from "./Replies";
import type { PaneId } from "./pane-ids";

const PANES: Record<PaneId, () => React.JSX.Element> = {
  lists: ListsPane,
  aliases: AliasesPane,
  connections: ConnectionsPane,
  retention: RetentionPane,
  replies: RepliesPane,
  assistant: AssistantPane,
};

export function SettingsView({ pane }: { pane: PaneId }) {
  const activeTab = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const tab = activeTab.current;
    const nav = tab?.parentElement;
    if (!tab || !nav || nav.scrollWidth <= nav.clientWidth) return;
    const item = tab.getBoundingClientRect();
    const rail = nav.getBoundingClientRect();
    nav.scrollLeft += item.left - rail.left - (nav.clientWidth - item.width) / 2;
  }, [pane]);
  const s = useDemo();
  const prop = s.aliases.filter((a) => a.state === "proposed").length;
  const on = connOn(s);
  const title = SETTINGS_PANES.find((t) => t[0] === pane)![1];
  const Pane = PANES[pane];
  return (
    <>
      <Header icon="gear" className="settings-header">Settings</Header>
      <div className="setwrap settings-layout">
        <nav className="setnav settings-tabs" aria-label="Settings sections">
          {SETTINGS_PANES.map(([k, l]) => (
            <Link key={k} href={`/settings/${k}`} ref={k === pane ? activeTab : undefined} className={k === pane ? "on" : ""} aria-current={k === pane ? "page" : undefined}>
              {l}
              {k === "aliases" && prop ? <span className="cnt">{prop} to approve</span> : null}
              {k === "connections" ? <span className="cnt">{on} of 3 on</span> : null}
            </Link>
          ))}
        </nav>
        <div className="setpane settings-content">
          <h2>{title}</h2>
          <Pane />
        </div>
      </div>
    </>
  );
}
