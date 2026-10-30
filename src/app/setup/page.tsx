"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setupAdministrator } from "@/auth";

export default function AdministratorSetup() {
  const router = useRouter();
  const tokenInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (token && tokenInput.current) { tokenInput.current.value = token; window.history.replaceState(null, "", "/setup"); }
  }, []);
  return <div className="ic-auth"><Link href="/" className="ic-brand">Invoice Checker</Link><main className="ic-card"><h1>Set up your administrator</h1>
    <p className="ic-hint">Use the one-time setup link prepared by the app operator. After setup, only an administrator can approve accounts.</p>
    <form style={{ display: "grid", gap: 16, marginTop: 20 }} onSubmit={async event => {
      event.preventDefault(); setError("");
      if (password !== confirmation) { setError("The passwords do not match."); return; }
      setBusy(true);
      try { await setupAdministrator(tokenInput.current?.value ?? "", username, password); router.replace("/admin/accounts"); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not set up the administrator."); }
      finally { setBusy(false); }
    }}>
      <label className="ic-field">Setup code<input className="ic-input" type="password" autoComplete="off" required minLength={32} ref={tokenInput} /></label>
      <label className="ic-field">Administrator username<input className="ic-input" required minLength={2} maxLength={80} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label className="ic-field">Password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className="ic-field">Confirm password<input className="ic-input" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}<button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Creating administrator…" : "Create administrator"}</button>
    </form>
  </main></div>;
}
