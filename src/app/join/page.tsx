"use client";

import Link from "next/link";
import { Brand } from "@/components/Brand";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { claimAccountInvitation, beginAccountEnrollment, completeAccountEnrollment, resendEnrollmentEmail, verifyEnrollmentEmail, type TwoFactorChallenge } from "@/auth";
import { TwoFactor } from "@/components/TwoFactor";

const subscribeHydration = () => () => {};

export default function JoinPage() {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return hydrated ? <AccountEnrollment /> : <div className="ic-auth"><main className="ic-card"><p>Loading account setup…</p></main></div>;
}

function AccountEnrollment() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<string | null>(() => new URLSearchParams(window.location.hash.slice(1)).get("invite"));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", "/join");
  }, []);
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restart = () => { setInvitation(null); setChallenge(null); setGrant(null); setPassword(""); setConfirmation(""); setError(""); };
  return <div className="ic-auth"><Brand /><main className="ic-card">
    <h1>Set up your approved account</h1>
    {grant ? <>
      <p className="ic-hint">Email verified{email ? `: ${email}` : ""}. Choose your username and password for your private workspace.</p>
      <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
        event.preventDefault(); setError("");
        if (password !== confirmation) { setError("The passwords do not match."); return; }
        setBusy(true);
        try { await completeAccountEnrollment(grant, username, password); setPassword(""); setConfirmation(""); router.replace("/master-list"); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create your account."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field">Username<input className="ic-input" required minLength={2} maxLength={80} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label className="ic-field">Password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="ic-field">Confirm password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <p className="ic-hint">Use 15 to 128 characters. Finish within five minutes of verifying your email. Future sign-ins require your password and a fresh email code.</p>
        <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Creating…" : "Create my account"}</button>
        <button className="ic-link" type="button" disabled={busy} onClick={restart}>Start setup again</button>
      </form>
    </> : invitation ? <>
      <p className="ic-hint">Your administrator invited you to Invoice Checker. Continue to verify your invitation and choose your own username and password.</p>
      <button className="ic-btn ic-btn--primary ic-btn--block" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const verified = await claimAccountInvitation(invitation); setEmail(verified.email); setGrant(verified.setup_grant); setInvitation(null); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify your invitation."); }
        finally { setBusy(false); }
      }}>{busy ? "Verifying…" : "Accept invitation"}</button>
      <button className="ic-link" type="button" disabled={busy} onClick={restart} style={{ marginTop: 16 }}>Use an email security code instead</button>
    </> : challenge ? <TwoFactor key={challenge.challenge_id} challenge={challenge} onVerify={async (id, code) => {
      const verified = await verifyEnrollmentEmail(id, code); setGrant(verified.setup_grant); setChallenge(null); setError("");
    }} onResend={resendEnrollmentEmail} onCancel={restart} /> : <>
      <p className="ic-hint">Enter the email address approved by your administrator. Verify your email before choosing your username and password.</p>
      <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { setChallenge(await beginAccountEnrollment(email)); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send a setup code."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field">Approved email address<input className="ic-input" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <p className="ic-hint">If this email has a pending approval, we’ll send a security code. Otherwise, ask your administrator to approve it.</p>
        <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Sending…" : "Send setup code"}</button>
      </form>
    </>}
    {error ? <p role="alert" className="ic-hint ic-hint--error" style={{ marginTop: 16 }}>{error}</p> : null}
    <p className="ic-hint" style={{ marginTop: 20 }}>Already have an account? <Link className="ic-link" href="/sign-in">Sign in</Link>.</p>
  </main></div>;
}
