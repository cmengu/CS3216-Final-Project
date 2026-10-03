"use client";

/*
 * People: the prototype's peopleView(). Owner only; anyone else gets Not found (404, never 403).
 * Add person, the shared login, everyone with "Switch to", and what each role sees.
 */
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { canEdit, canInvoice, canPrice, isOwner, needsPin } from "@/platform/access";
import { GROUP_LOGIN, ROLES } from "@/sample";
import type { Person, Role } from "@/sample";
import { addPerson } from "@/state/actions/people";
import { meOf, useDemo } from "@/state/demo-store";
import { pick } from "@/state/session";
import { initials } from "@/lib/format";

const rowStyle: CSSProperties = { paddingLeft: 16, paddingRight: 16, gridTemplateColumns: "auto auto minmax(0,1fr) auto" };
const avStyle = { "--c": "var(--ink3)" } as CSSProperties;

/* The role table reads from the same helpers that apply the roles. */
const asRole = (role: Role): Person => ({ id: "", name: "", email: "", role, customers: role === "account_manager" ? [] : "all" });

export function PeopleView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = { name: "", email: "", role: "owner" as Role, customer: "all" };
  const [form, setForm] = useState(blank);

  if (!isOwner(u))
    return (
      <>
        <Header>Not found</Header>
        <div className="body" />
      </>
    );

  // The prototype's askWho(): Owner and Finance confirm with a PIN unless it is already them.
  const askWho = (id: string) => {
    const p = s.people.find((x) => x.id === id);
    if (p && needsPin(p) && id !== s.user) router.push(`/who?pin=${id}`);
    else {
      pick(id);
      router.push("/home");
    }
  };

  const send = () => {
    const r = addPerson(form);
    shell.toast(r.toast);
    if (r.ok) {
      setForm(blank);
      setOpen(false);
    }
  };

  const custText = (p: Person) => (p.customers === "all" ? "all customers" : p.customers.map((c) => s.customers[c]?.name ?? c).join(", "));

  return (
    <>
      <Header
        acts={
          <button className="btn p s" onClick={() => setOpen(!open)}>
            <Icon name="plus" />
            Add person
          </button>
        }
      >
        People
      </Header>
      <div className="body">
        <div className="card" id="addp" hidden={!open}>
          <div className="form">
            <label>
              Name
              <input id="pn" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Email
              <input id="pe" placeholder="name@company.example" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Role
              <select id="pr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {Object.entries(ROLES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customers
              <select id="pc" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })}>
                <option value="all">All customers</option>
                {Object.values(s.customers).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} only
                  </option>
                ))}
              </select>
            </label>
            <label>
              {" "}
              <button className="btn p" onClick={send}>
                Send invite
              </button>
            </label>
          </div>
        </div>
        <div className="card">
          <h3>Shared login</h3>
          <div className="kv2">
            <span>{GROUP_LOGIN}</span>
            <small>One sign-in for the team. Each person picks their name; Owner and Finance need a PIN.</small>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {s.people.map((p) => (
            <div className="row" style={rowStyle} key={p.id}>
              <span className="who">
                <span className="avc" style={avStyle}>
                  {initials(p.name)}
                </span>
                <b>{p.name}</b>
              </span>
              <span className="tag">{ROLES[p.role]}</span>
              <span className="sub">{`${p.email} · ${custText(p)}${p.invite ? ` · invite ${p.invite}` : ""}`}</span>
              <span className="when">
                <button className="btn s g" onClick={() => askWho(p.id)}>
                  Switch to
                </button>
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>What each role sees</h3>
          <div className="scroll" style={{ border: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Orders</th>
                  <th>Prices</th>
                  <th>Add &amp; confirm</th>
                  <th>Invoices</th>
                  <th>People, settings</th>
                </tr>
              </thead>
              <tbody>
                {(Object.entries(ROLES) as [Role, string][]).map(([k, v]) => {
                  const r = asRole(k);
                  return (
                    <tr key={k}>
                      <td>{v}</td>
                      <td>{k === "account_manager" ? "own customers" : "all"}</td>
                      <td>{canPrice(r) ? "yes" : "hidden"}</td>
                      <td>{canEdit(r) ? "yes" : "—"}</td>
                      <td>{canInvoice(r) ? "yes" : "—"}</td>
                      <td>{isOwner(r) ? "yes" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
