"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, completeSignIn, type TwoFactorChallenge } from "@/auth";
import { accountRequest } from "@/auth/accounts";
import { TwoFactor } from "@/components/TwoFactor";

export default function AccountSettings() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [replace, setReplace] = useState(false);
  const [factorPassword, setFactorPassword] = useState("");
  const [factorCode, setFactorCode] = useState("");
  const [factorError, setFactorError] = useState("");
  const [factorBusy, setFactorBusy] = useState(false);
  const [factorNotice, setFactorNotice] = useState("");
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
    <section className="ic-card" style={{ display: "grid", gap: 16, marginTop: 24 }}><h2>Two-factor authentication</h2>
      <p>Required for every approved account. Keep your recovery codes safe. Replacing your authenticator signs out other sessions and replaces all recovery codes.</p>
      {factorNotice ? <p role="status">{factorNotice}</p> : null}
      {challenge ? <TwoFactor key={challenge.challenge_id} challenge={challenge} onComplete={user => { completeSignIn(user); setChallenge(null); setReplace(false); setFactorNotice("Authenticator replaced. Your new recovery codes are now active."); }} /> : replace ? <form style={{ display: "grid", gap: 16 }} onSubmit={async event => {
        event.preventDefault(); setFactorBusy(true); setFactorError("");
        try {
          const next = await accountRequest<TwoFactorChallenge>("/auth/mfa/replace", { method: "POST", body: JSON.stringify({ password: factorPassword, code: factorCode }) });
          setFactorPassword(""); setFactorCode(""); setChallenge(next);
        } catch (reason) { setFactorError(reason instanceof Error ? reason.message : "Could not replace your authenticator."); }
        finally { setFactorBusy(false); }
      }}>
        <label className="ic-field">Current password for authenticator change<input className="ic-input" type="password" required maxLength={128} autoComplete="current-password" value={factorPassword} onChange={event => setFactorPassword(event.target.value)} /></label>
        <label className="ic-field">Fresh authenticator code or unused recovery code<input className="ic-input" required maxLength={128} autoComplete="one-time-code" value={factorCode} onChange={event => setFactorCode(event.target.value)} /></label>
        {factorError ? <p role="alert">{factorError}</p> : null}
        <button className="ic-btn ic-btn--primary" disabled={factorBusy}>{factorBusy ? "Verifying…" : "Verify and connect a new authenticator"}</button>
        <button className="ic-link" type="button" disabled={factorBusy} onClick={() => { setReplace(false); setFactorCode(""); setFactorPassword(""); }}>Cancel</button>
      </form> : <button className="ic-btn ic-btn--secondary" onClick={() => { setReplace(true); setFactorNotice(""); }}>Replace authenticator</button>}
    </section>
  </div>;
}
