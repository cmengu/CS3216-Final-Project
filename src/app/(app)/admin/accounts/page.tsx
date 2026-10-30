"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/auth";
import styles from "./Accounts.module.css";
import { accountRequest, type ApprovedAccount } from "@/auth/accounts";

export default function ApprovedAccounts() {
  const user = useUser();
  const [accounts, setAccounts] = useState<ApprovedAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    if (user?.role !== "admin") return;
    let current = true;
    accountRequest<ApprovedAccount[]>("/admin/accounts").then(rows => { if (current) setAccounts(rows); }).catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [user?.role]);

  async function change(id: string, values: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const changed = await accountRequest<ApprovedAccount>(`/admin/accounts/${id}`, { method: "PATCH", body: JSON.stringify(values) });
      setAccounts(rows => rows.map(row => row.id === id ? changed : row));
      setResetId(null); setResetPassword("");
      setNotice(values.password ? "Password reset. Existing sessions have been signed out." : "Account access updated. Existing sessions have been signed out.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update this account."); }
    finally { setBusy(false); }
  }

  if (user?.role !== "admin") return <div className="ic-page"><h1 className="ic-h1">Administrator access required</h1><p>Only an administrator can manage approved accounts.</p></div>;

  return <div className="ic-page" style={{ maxWidth: 1120, margin: "0 auto" }}>
    <h1 className="ic-h1">Approved accounts</h1>
    <p className="muted">Only these accounts can sign in. Every account has a private invoice workspace and Outlook connection.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status" className="ic-ok">{notice}</p> : null}
    <section className="ic-card" aria-labelledby="add-account-title" style={{ margin: "24px 0" }}>
      <h2 id="add-account-title" style={{ marginTop: 0 }}>Add an account</h2>
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(""); setNotice("");
        try {
          const created = await accountRequest<ApprovedAccount>("/admin/accounts", { method: "POST", body: JSON.stringify({ username, password, role }) });
          setAccounts(rows => [...rows, created]); setUsername(""); setPassword(""); setRole("member");
          setNotice("Account approved. Share the credentials with this person through your usual private channel.");
        } catch (error) { setError(error instanceof Error ? error.message : "Could not add this account."); }
        finally { setBusy(false); }
      }}>
        <div className="ic-field"><label htmlFor="new-username">Username</label><input id="new-username" className="ic-input" required minLength={2} maxLength={80} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></div>
        <div className="ic-field"><label htmlFor="new-password">Initial password</label><input id="new-password" className="ic-input" type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><span className="ic-hint">15 to 128 characters.</span></div>
        <div className="ic-field"><label htmlFor="new-role">Access</label><select id="new-role" className="ic-select" value={role} onChange={event => setRole(event.target.value as "admin" | "member")}><option value="member">Member</option><option value="admin">Administrator</option></select></div>
        <button className="ic-btn ic-btn--primary" disabled={busy}>Approve account</button>
      </form>
    </section>
    <div className="ic-card" style={{ overflowX: "auto", padding: 0 }}>
      <table className="ic-grid" aria-label="Approved accounts"><thead><tr><th>Username</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {accounts.map(account => <tr key={account.id}><td>{account.username}{account.id === user.id ? " (you)" : ""}</td><td>{account.role === "admin" ? "Administrator" : "Member"}</td><td>{account.active ? "Approved" : "Disabled"}</td><td>
          {account.id === user.id ? <span className="muted">Your account</span> : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={() => void change(account.id, { active: !account.active })}>{account.active ? "Disable" : "Enable"}</button>
            <button className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={() => { setResetId(account.id); setResetPassword(""); }}>Reset password</button>
            <button className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={() => void change(account.id, { role: account.role === "admin" ? "member" : "admin" })}>{account.role === "admin" ? "Make member" : "Make administrator"}</button>
          </div>}
          {resetId === account.id ? <form style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }} onSubmit={event => { event.preventDefault(); void change(account.id, { password: resetPassword }); }}>
            <label className="ic-field">New password for {account.username}<input className="ic-input" type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} /></label>
            <button className="ic-btn ic-btn--primary ic-btn--sm" disabled={busy}>Save password</button><button type="button" className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={() => { setResetId(null); setResetPassword(""); }}>Cancel</button>
          </form> : null}
        </td></tr>)}
      </tbody></table>
    </div>
  </div>;
}
