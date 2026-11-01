"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginPasswordReset, completePasswordReset, resendPasswordResetEmail, verifyPasswordResetEmail, type TwoFactorChallenge } from "@/auth";
import { TwoFactor } from "@/components/TwoFactor";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const restart = () => { setChallenge(null); setGrant(null); setPassword(""); setConfirmation(""); setError(""); };
  return <div className="ic-auth"><Link href="/" className="ic-brand">Invoice Checker</Link><main className="ic-card">
    <h1>{done ? "Password reset" : "Reset your password"}</h1>
    {done ? <>
      <p role="status">Your password has been changed and all existing sessions have been signed out.</p>
      <p className="ic-hint">Sign in with your username or registered email and new password. We’ll send a fresh email security code.</p>
      <Link className="ic-btn ic-btn--primary ic-btn--block" href="/sign-in">Continue to sign in</Link>
    </> : grant ? <>
      <p className="ic-hint">Email verified. Choose a new password for your account.</p>
      <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
        event.preventDefault(); setError("");
        if (password !== confirmation) { setError("The passwords do not match."); return; }
        setBusy(true);
        try { await completePasswordReset(grant, password); setPassword(""); setConfirmation(""); setGrant(null); setDone(true); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset your password."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field">New password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="ic-field">Confirm new password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <p className="ic-hint">Use 15 to 128 characters. Finish within five minutes of verifying your email. Existing sessions will be signed out; your private workspace stays the same.</p>
        <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
        <button className="ic-link" type="button" disabled={busy} onClick={restart}>Start password reset again</button>
      </form>
    </> : challenge ? <TwoFactor key={challenge.challenge_id} challenge={challenge} onVerify={async (id, code) => {
      const verified = await verifyPasswordResetEmail(id, code); setGrant(verified.reset_grant); setChallenge(null); setError("");
    }} onResend={resendPasswordResetEmail} onCancel={() => router.replace("/sign-in")} /> : <>
      <p className="ic-hint">Enter your registered email address to reset your password.</p>
      <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { setChallenge(await beginPasswordReset(email)); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send a reset code."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field">Registered email address<input className="ic-input" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <p className="ic-hint">If this email belongs to an active account, we’ll send a security code. Check your junk folder too.</p>
        <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
      </form>
    </>}
    {error ? <p role="alert" className="ic-hint ic-hint--error" style={{ marginTop: 16 }}>{error}</p> : null}
    {!done ? <p className="ic-hint" style={{ marginTop: 20 }}><Link className="ic-link" href="/sign-in">Back to sign in</Link></p> : null}
  </main></div>;
}
