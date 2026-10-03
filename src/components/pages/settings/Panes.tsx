"use client";

/* Settings panes: Products and customers, Aliases, Retention, Assistant access (prototype: settingsView). */
import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { Icon } from "@/components/icons";
import { useShell } from "@/components/shell/context";
import { PRODUCTS, ROLES } from "@/sample";
import { useDemo, update } from "@/state/demo-store";
import {
  aliasNo,
  aliasOk,
  aliasSet,
  createKey,
  demoKey,
  revokeKey,
  setRetainsRows,
  setRetentionDays,
  setSkuList,
  skuRows,
} from "@/state/actions/settings";
import { money } from "@/lib/format";

export function ListsPane() {
  const s = useDemo();
  const { toast } = useShell();
  const items = Object.entries(PRODUCTS);
  const custs = Object.values(s.customers);
  const prop = s.aliases.filter((a) => a.state === "proposed").length;
  const appr = s.aliases.filter((a) => a.state === "approved").length;

  // The prototype counts the file's lines (less the header); nothing is parsed or kept.
  const uploadSku = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const n = skuRows(String(r.result));
      update((d) => setSkuList(d, n));
      toast(`SKU list read · ${n} items`);
    };
    r.onerror = () => toast("Could not read this file");
    r.readAsText(f);
  };

  return (
    <>
      <div className="clist">
        <div className="citem">
          <div className="conn">
            <span className="ci t-info">
              <Icon name="doc" />
            </span>
            <span className="ct">
              <b>Product list</b>
              <small>Fills SKU, SKU Lookup and Price on every row</small>
            </span>
            <span className="ca">
              <label className="btn s" style={{ cursor: "pointer" }}>
                Replace file
                <input type="file" accept=".csv,.xlsx,.txt" hidden onChange={uploadSku} />
              </label>
            </span>
          </div>
          <div className="cbody">
            <div className="hint">
              {s.settings.skuCount} products · updated {s.settings.skuDate}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>SKU Lookup</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 4).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{v.name}</td>
                    <td style={{ textAlign: "right" }}>{money(v.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > 4 ? <div className="hint">and {items.length - 4} more</div> : null}
          </div>
        </div>
        <div className="citem">
          <div className="conn">
            <span className="ci t-good">
              <Icon name="building" />
            </span>
            <span className="ct">
              <b>Customer list</b>
              <small>Fills Customer ID, Location, Delivery or Pickup and AM / PM</small>
            </span>
            <span className="ca">
              <label className="btn s" style={{ cursor: "pointer" }}>
                Replace file
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  hidden
                  onChange={() => toast("Customer list read · " + Object.keys(s.customers).length + " rows unchanged")}
                />
              </label>
            </span>
          </div>
          <div className="cbody">
            <div className="hint">
              {`${custs.length} customers · ${custs.reduce((a, c) => a + c.outlets.length, 0)} outlets`}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Customer ID</th>
                  <th>Customer</th>
                  <th>Outlets</th>
                  <th>Location</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {custs.slice(0, 4).map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.outlets.join(", ")}</td>
                    <td>{c.location}</td>
                    <td>{c.slot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {custs.length > 4 ? <div className="hint">and {custs.length - 4} more</div> : null}
          </div>
        </div>
      </div>
      <Link className="mailrow" href="/settings/aliases">
        <Icon name="warn" />
        <b>When a PO words an item differently</b>
        <span className="hint">
          {appr} approved matches{prop ? ` · ${prop} to approve` : ""}
        </span>
        <span className="btn s">Aliases</span>
      </Link>
    </>
  );
}

export function AliasesPane() {
  const s = useDemo();
  const { toast } = useShell();
  const prop = s.aliases.filter((a) => a.state === "proposed");
  const appr = s.aliases.filter((a) => a.state === "approved");
  return (
    <div className="card">
      <h3>
        Aliases
        {prop.length ? (
          <>
            {" "}
            <span className="lbl l-warn" style={{ marginLeft: 6 }}>
              {prop.length} to approve
            </span>
          </>
        ) : null}
      </h3>
      <div className="scroll" style={{ border: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Text on the PO</th>
              <th>SKU</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...prop, ...appr].map((a) => (
              <tr key={a.text}>
                <td>
                  <span>{`“${a.text}”`}</span>
                  {a.seen ? (
                    <>
                      {" "}
                      <span className="hint">{`· ${a.seen}`}</span>
                    </>
                  ) : null}
                </td>
                <td className="mono">
                  {a.sku ? (
                    <>
                      {a.sku} <span className="hint">{PRODUCTS[a.sku]?.name || ""}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {a.state === "approved" ? (
                    <span className="lbl l-good">
                      <Icon name="check" />
                      {`Approved · ${a.by}`}
                    </span>
                  ) : (
                    <span className="lbl l-warn">
                      <Icon name="warn" />
                      Proposed
                    </span>
                  )}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {a.state === "proposed" ? (
                    <>
                      {a.sku ? (
                        <button
                          className="btn s p"
                          onClick={() => {
                            update((d) => aliasOk(d, a.text));
                            toast("Approved");
                          }}
                        >
                          Approve
                        </button>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => update((d) => aliasSet(d, a.text, e.target.value))}
                          style={{ padding: "3px 6px", fontSize: 12 }}
                        >
                          <option value="">Pick SKU…</option>
                          {Object.keys(PRODUCTS).map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      )}{" "}
                      <button
                        className="btn s g"
                        onClick={() => {
                          update((d) => aliasNo(d, a.text));
                          toast("Rejected");
                        }}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RetentionPane() {
  const s = useDemo();
  return (
    <div className="card">
      <h3>Retention</h3>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" id="ret" checked={s.settings.retainsRows} onChange={(e) => update((d) => setRetainsRows(d, e.target.checked))} />
        {" Keep confirmed rows (never PDFs)"}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        Delete after{" "}
        <input
          type="number"
          defaultValue={s.settings.retentionDays}
          style={{ width: 80 }}
          onChange={(e) => update((d) => setRetentionDays(d, +e.target.value))}
        />{" "}
        days
      </label>
    </div>
  );
}

/** The key just created, shown until copied, as the prototype keeps S._newKey; in memory only, never stored. */
let keptKey: string | null = null;

export function AssistantPane() {
  const s = useDemo();
  const { copyText } = useShell();
  const [newKey, setNewKeyState] = useState<string | null>(keptKey);
  const setNewKey = (k: string | null) => {
    keptKey = k;
    setNewKeyState(k);
  };
  const [who, setWho] = useState(s.people[0]?.id ?? "");
  return (
    <div className="card">
      <h3>Assistant access</h3>
      <div className="hint">Read-only keys for ChatGPT or Claude. Each key answers as its owner.</div>
      {s.keys.map((k) => (
        <div className="keybox" style={{ marginTop: 8 }} key={k.id}>
          <span>{k.label}</span>
          <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>
            {k.masked} · {k.who}
          </span>
          <button className="ib" onClick={() => update((d) => revokeKey(d, k.id))} title="Revoke">
            <Icon name="x" />
          </button>
        </div>
      ))}
      {newKey ? (
        <>
          <div className="keybox" style={{ marginTop: 8, borderColor: "var(--good)" }}>
            {newKey}
            <button
              className="btn s"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                copyText(newKey, "Copied key");
                setNewKey(null);
              }}
            >
              Copy
            </button>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            Shown once.
          </div>
        </>
      ) : null}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <select id="keyWho" value={who} onChange={(e) => setWho(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
          {s.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {ROLES[p.role]}
            </option>
          ))}
        </select>
        <button
          className="btn s"
          onClick={() => {
            const raw = demoKey();
            update((d) => createKey(d, who, raw));
            setNewKey(raw);
          }}
        >
          Create key
        </button>
      </div>
    </div>
  );
}
