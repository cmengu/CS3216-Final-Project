"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/auth";

export default function AccountSettings() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="ic-page ic-page--narrow"><h1 className="ic-h1">Change password</h1><p className="muted">Changing your password signs out all your current sessions. Your saved invoices stay in your private workspace.</p>
    <form className="ic-card" style={{ display: "grid", gap: 16, marginTop: 24 }} onSubmit={async event => {
      event.preventDefault(); setError("");
      if (password !== confirmation) { setError("The new passwords do not match."); return; }
      setBusy(true);
      try { await changePassword(current, password); router.replace("/sign-in"); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not change your password."); }
      finally { setBusy(false); }
    }}>
      <label className="ic-field">Current password<input className="ic-input" type="password" required maxLength={128} autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} /></label>
      <label className="ic-field">New password<input className="ic-input" type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><span className="ic-hint">15 to 128 characters.</span></label>
      <label className="ic-field">Confirm new password<input className="ic-input" type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}<button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Saving…" : "Change password and sign out"}</button>
    </form>
  </div>;
}
