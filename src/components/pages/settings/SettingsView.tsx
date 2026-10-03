"use client";

/*
 * Settings (owner only): the side menu and its six panes, ported from the prototype's settingsView().
 * Pane ids are the prototype's: lists, aliases, connections, retention, replies, assistant.
 */
import Link from "next/link";
import { Header } from "@/components/shell/Header";
import { isOwner } from "@/platform/access";
import { SETTINGS_PANES } from "@/platform/nav";
import { meOf, useDemo } from "@/state/demo-store";
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
  const s = useDemo();
  if (!isOwner(meOf(s)))
    return (
      <>
        <Header>Not found</Header>
        <div className="body" />
      </>
    );
  const prop = s.aliases.filter((a) => a.state === "proposed").length;
  const on = connOn(s);
  const title = SETTINGS_PANES.find((t) => t[0] === pane)![1];
  const Pane = PANES[pane];
  return (
    <>
      <Header>Settings</Header>
      <div className="setwrap">
        <nav className="setnav">
          {SETTINGS_PANES.map(([k, l]) => (
            <Link key={k} href={`/settings/${k}`} className={k === pane ? "on" : ""}>
              {l}
              {k === "aliases" && prop ? <span className="cnt">{prop} to approve</span> : null}
              {k === "connections" ? <span className="cnt">{on} of 3 on</span> : null}
            </Link>
          ))}
        </nav>
        <div className="setpane">
          <h2>{title}</h2>
          <Pane />
        </div>
      </div>
    </>
  );
}
