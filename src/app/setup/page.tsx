"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeSignIn, setupAdministrator, type TwoFactorChallenge } from "@/auth";
import { TwoFactor } from "@/components/TwoFactor";

export default function AdministratorSetup() {
  const router = useRouter();
  const tokenInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (token && tokenInput.current) { tokenInput.current.value = token; window.history.replaceState(null, "", "/setup"); }
  }, []);
  return <div className="ic-auth"><Link href="/" className="ic-brand">Invoice Checker</Link><main className="ic-card"><h1>Set up your administrator</h1>
    <p className="ic-hint">Choose your administrator credentials, then confirm the security code sent to the email approved by the server owner.</p>
    {challenge ? <TwoFactor challenge={challenge} onComplete={user => { completeSignIn(user); router.replace("/admin/accounts"); }} onCancel={() => router.replace("/sign-in")} /> : <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
      event.preventDefault(); setError("");
      if (password !== confirmation) { setError("The passwords do not match."); return; }
      setBusy(true);
      try { const next = await setupAdministrator(tokenInput.current?.value ?? "", username, password); setPassword(""); setConfirmation(""); setChallenge(next); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not set up the administrator."); }
      finally { setBusy(false); }
    }}>
      <label className="ic-field">Setup code<input className="ic-input" type="password" autoComplete="off" required minLength={32} ref={tokenInput} /></label>
      <label className="ic-field">Administrator username<input className="ic-input" required minLength={2} maxLength={80} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label className="ic-field">Password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className="ic-field">Confirm password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}<button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Creating administrator…" : "Create administrator"}</button>
    </form>}
    <p className="ic-hint" style={{ marginTop: 20 }}>Already chose your credentials? <Link className="ic-link" href="/sign-in">Sign in to finish email verification</Link>.</p>
  </main></div>;
}
