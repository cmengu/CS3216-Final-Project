/*
 * People actions, as the prototype's addPerson(). In the demo "Send invite" adds the person to
 * the picker and the history, and sends nothing. Later this becomes a server action that sends
 * a real invite link.
 */
import { ROLES, TODAY } from "@/sample";
import type { DemoState, Person, Role } from "@/sample";
import { meOf, update } from "@/state/demo-store";

export interface PersonInput {
  name: string;
  email: string;
  role: Role;
  /** "all", or one customer ID ("<customer> only" in the form). */
  customer: string;
}

/** The prototype's nowStr(): the demo's fixed day with the clock's hours and minutes. */
export function nowStr(d: Date = new Date()): string {
  return TODAY + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

const inviteCode = () => Math.random().toString(36).slice(2, 8);

/**
 * Add a person to a draft of the state. Returns the toast to show: the error when name or email
 * is missing (nothing changes), or "Invite sent to <name>".
 */
export function addPersonTo(
  draft: DemoState,
  input: PersonInput,
  opts: { at?: string; code?: string } = {},
): { ok: boolean; toast: string; person?: Person } {
  const n = input.name.trim();
  const e = input.email.trim();
  if (!n || !e) return { ok: false, toast: "Name and email required" };
  const by = meOf(draft).name;
  const person: Person = {
    id: "u" + ++draft.seq,
    name: n,
    role: input.role,
    email: e,
    customers: input.customer === "all" ? "all" : [input.customer],
    invite: "pot.example/i/" + (opts.code ?? inviteCode()),
  };
  draft.people.push(person);
  draft.history.push({ at: opts.at ?? nowStr(), who: by, kind: "role_changed", order: null, text: `Added ${n} as ${ROLES[input.role]}` });
  return { ok: true, toast: `Invite sent to ${n}`, person };
}

/** Add a person to the demo store. Returns the toast to show. */
export function addPerson(input: PersonInput): { ok: boolean; toast: string } {
  const n = input.name.trim();
  const e = input.email.trim();
  if (!n || !e) return { ok: false, toast: "Name and email required" };
  let out: { ok: boolean; toast: string } = { ok: false, toast: "" };
  update((draft) => {
    out = addPersonTo(draft, input);
  });
  return out;
}
