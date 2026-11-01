"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useUser } from "@/auth";
import styles from "./Accounts.module.css";
import { accountRequest, type AccountApproval, type ApprovedAccount } from "@/auth/accounts";

export default function ApprovedAccounts() {
  const user = useUser();
  const [accounts, setAccounts] = useState<ApprovedAccount[]>([]);
  const [approvals, setApprovals] = useState<AccountApproval[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    if (user?.role !== "admin") return;
    let current = true;
    Promise.all([
      accountRequest<ApprovedAccount[]>("/admin/accounts"),
      accountRequest<AccountApproval[]>("/admin/account-approvals"),
    ]).then(([rows, pending]) => { if (current) { setAccounts(rows); setApprovals(pending); } }).catch(error => { if (current) setError(error.message); });
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
          const created = await accountRequest<AccountApproval>("/admin/accounts", { method: "POST", body: JSON.stringify({ email }) });
          setApprovals(rows => [...rows, created]);
          setEmail(""); setNotice(created.invitation_status === "sent"
            ? "Invitation emailed. The recipient can open their personal join link and choose a username and password."
            : `Email approved, but the invitation was not sent. ${created.invitation_error ?? "Check email delivery and try Send invitation below."}`);
        } catch (error) { setError(error instanceof Error ? error.message : "Could not add this account."); }
        finally { setBusy(false); }
      }}>
        <div className="ic-field"><label htmlFor="new-email">Email address</label><input id="new-email" className="ic-input" type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></div>
        <button className="ic-btn ic-btn--primary" disabled={busy}>Approve &amp; send invitation</button>
      </form>
    </section>
    <section className="ic-card" aria-labelledby="pending-approvals-title" style={{ margin: "24px 0", overflowX: "auto" }}>
      <h2 id="pending-approvals-title" style={{ marginTop: 0 }}>Waiting for account setup</h2>
      <p className="ic-hint">Recipients receive a personal join link, valid for 24 hours. It creates an account only for the approved email. New users start as members. The <Link className="ic-link" href="/join">account setup page</Link> also supports email codes.</p>
      {approvals.length ? <table className="ic-grid" aria-label="Pending email approvals"><thead><tr><th>Email address</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {approvals.map(approval => <tr key={approval.id}><td>{approval.email}</td><td>{approval.invitation_status === "sent" ? "Invitation sent" : approval.invitation_status === "failed" ? "Email not sent" : "Waiting for setup"}{approval.invitation_error ? <p className="ic-hint ic-hint--error">{approval.invitation_error}</p> : null}</td><td><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const delivery = await accountRequest<Pick<AccountApproval, "invitation_status" | "invitation_error">>(`/admin/account-approvals/${approval.id}/send`, { method: "POST" });
            setApprovals(rows => rows.map(row => row.id === approval.id ? { ...row, ...delivery } : row));
            setNotice(delivery.invitation_status === "sent" ? "Invitation emailed. Only the newest link will work." : `The invitation was not sent. ${delivery.invitation_error ?? "Check email delivery."}`);
          } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the invitation."); }
          finally { setBusy(false); }
        }}>{approval.invitation_status === "sent" ? "Resend invitation" : "Send invitation"}</button><button className="ic-btn ic-btn--secondary ic-btn--sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            await accountRequest(`/admin/account-approvals/${approval.id}`, { method: "DELETE" });
            setApprovals(rows => rows.filter(row => row.id !== approval.id)); setNotice("Email approval revoked. Pending codes and account setup are cancelled.");
          } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke this approval."); }
          finally { setBusy(false); }
        }}>Revoke approval</button></div></td></tr>)}
      </tbody></table> : <p className="muted">No emails waiting for setup.</p>}
    </section>
    <div className="ic-card" style={{ overflowX: "auto", padding: 0 }}>
      <table className="ic-grid" aria-label="Approved accounts"><thead><tr><th>Username</th><th>Security email</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {accounts.map(account => <tr key={account.id}><td>{account.username}{account.id === user.id ? " (you)" : ""}</td><td>{account.email ?? "Operator setup required"}</td><td>{account.role === "admin" ? "Administrator" : "Member"}</td><td>{account.active ? "Approved" : "Disabled"}</td><td>
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
