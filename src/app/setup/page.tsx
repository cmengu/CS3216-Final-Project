"use client";

import Link from "next/link";
import { Brand } from "@/components/Brand";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { beginAdministratorSetup, resendAdministratorEmail, setupAdministrator, verifyAdministratorEmail, type TwoFactorChallenge } from "@/auth";
import { accountRequest } from "@/auth/accounts";
import { TwoFactor } from "@/components/TwoFactor";

interface SetupStatus { setup_required: boolean; setup_destination: string | null; email_delivery_configured: boolean }

export default function AdministratorSetup() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // Old private links may still contain a retired setup token; never retain it in the URL.
    if (window.location.hash) window.history.replaceState(null, "", "/setup");
    let active = true;
    accountRequest<SetupStatus>("/auth/setup-status").then(value => { if (active) setStatus(value); }).catch(() => { if (active) setError("Administrator setup could not be loaded. Check the connection and refresh."); });
    return () => { active = false; };
  }, []);
  const restart = () => { setChallenge(null); setGrant(null); setPassword(""); setConfirmation(""); setError(""); };
  return <div className="ic-auth"><Brand /><main className="ic-card"><h1>Set up your administrator</h1>
    {status?.setup_required === false ? <p>Administrator setup is already complete. <Link className="ic-link" href="/sign-in">Sign in</Link>.</p> : grant ? <>
      <p className="ic-hint">Email verified. Now choose your administrator username and password.</p>
      <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
        event.preventDefault(); setError("");
        if (password !== confirmation) { setError("The passwords do not match."); return; }
        setBusy(true);
        try { await setupAdministrator(grant, username, password); setPassword(""); setConfirmation(""); router.replace("/admin/accounts"); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the administrator."); }
        finally { setBusy(false); }
      }}>
        <label className="ic-field">Administrator username<input className="ic-input" required minLength={2} maxLength={80} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label className="ic-field">Password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="ic-field">Confirm password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <p className="ic-hint">Finish within five minutes of verifying your email. Future sign-ins require your password and a fresh email code.</p>
        <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Creating…" : "Create administrator"}</button>
        <button className="ic-link" type="button" disabled={busy} onClick={restart}>Start setup again</button>
      </form>
    </> : challenge ? <TwoFactor key={challenge.challenge_id} challenge={challenge} onVerify={async (id, code) => {
      const verified = await verifyAdministratorEmail(id, code); setGrant(verified.setup_grant); setChallenge(null); setError("");
    }} onResend={resendAdministratorEmail} onCancel={restart} /> : <>
      <p className="ic-hint">Verify the email configured by the server owner before creating an administrator. No administrator password needs to be stored in configuration.</p>
      {!status ? <p>Loading setup…</p> : <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
        <p>Send a security code to <strong>{status.setup_destination ?? "the approved administrator email"}</strong>.</p>
        {!status.email_delivery_configured || !status.setup_destination ? <p role="status">Ask the operator to finish configuring the administrator email and email delivery.</p> : null}
        <button className="ic-btn ic-btn--primary" disabled={busy || !status.email_delivery_configured || !status.setup_destination} onClick={async () => {
          setBusy(true); setError("");
          try { setChallenge(await beginAdministratorSetup()); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send a setup code."); }
          finally { setBusy(false); }
        }}>{busy ? "Sending…" : "Send setup code"}</button>
      </div>}
    </>}
    {error ? <p role="alert" className="ic-hint ic-hint--error" style={{ marginTop: 16 }}>{error}</p> : null}
    <p className="ic-hint" style={{ marginTop: 20 }}><Link className="ic-link" href="/sign-in">Back to sign in</Link></p>
  </main></div>;
}
