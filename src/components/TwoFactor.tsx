"use client";

import { useEffect, useState } from "react";
import { resendSecondFactor, verifySecondFactor, type TwoFactorChallenge, type User } from "@/auth";
import styles from "./TwoFactor.module.css";

export function TwoFactor({ challenge: initial, onComplete, onCancel }: {
  challenge: TwoFactorChallenge;
  onComplete: (user: User) => void;
  onCancel?: () => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [remaining, setRemaining] = useState(initial.resend_after);
  const [resendAt, setResendAt] = useState(() => Date.now() + initial.resend_after * 1000);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  return <section className={styles.flow} aria-label="Email security verification">
    <h2>Check your email</h2>
    <p>Enter the six-digit security code sent to <strong>{challenge.destination}</strong>. It expires after five minutes and can be used once.</p>
    <form className={styles.flow} onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setNotice("");
      try {
        const verified = await verifySecondFactor(challenge.challenge_id, code.trim());
        setCode(""); onComplete(verified.user);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify that code."); }
      finally { setBusy(false); }
    }}>
      <label className="ic-field">Email security code<input className="ic-input" type="text" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value)} /></label>
      {error ? <p role="alert" className="ic-hint ic-hint--error">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button>
      <div className={styles.actions}>
        <button className="ic-link" type="button" disabled={busy || remaining > 0} onClick={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const next = await resendSecondFactor(challenge.challenge_id);
            setChallenge(next); setRemaining(next.resend_after); setResendAt(Date.now() + next.resend_after * 1000); setCode(""); setNotice("A new code was sent. Only the most recent code will work.");
          } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not resend the code."); }
          finally { setBusy(false); }
        }}>{remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}</button>
        {onCancel ? <button className="ic-link" type="button" disabled={busy} onClick={onCancel}>Back to sign in</button> : null}
      </div>
      <p className="ic-hint">Check your junk folder. If verification expires or you lose access to this inbox, ask the operator for help.</p>
    </form>
  </section>;
}
