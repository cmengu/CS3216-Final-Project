"use client";

import Image from "next/image";
import { useState } from "react";
import { verifySecondFactor, type TwoFactorChallenge, type TwoFactorResult, type User } from "@/auth";
import styles from "./TwoFactor.module.css";

export function TwoFactor({ challenge, onComplete, onCancel }: {
  challenge: TwoFactorChallenge;
  onComplete: (user: User) => void;
  onCancel?: () => void;
}) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TwoFactorResult | null>(null);
  const [saved, setSaved] = useState(false);
  if (result?.recovery_codes?.length) {
    const text = `Invoice Checker recovery codes for ${result.user.email}\nEach code can be used only once. Keep these codes private.\n\n${result.recovery_codes.join("\n")}\n`;
    return <section className={styles.flow} aria-label="Recovery codes">
      <h2>Save your recovery codes</h2>
      <p>Use one of these codes with your password if you lose your phone. Each code works once. These codes are shown only now.</p>
      <ul className={styles.codes}>{result.recovery_codes.map(value => <li key={value}><code>{value}</code></li>)}</ul>
      <a className="ic-btn ic-btn--secondary" download="invoice-checker-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>Download recovery codes</a>
      <label className={styles.confirmation}><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />I have saved my recovery codes somewhere safe.</label>
      <button type="button" className="ic-btn ic-btn--primary" disabled={!saved} onClick={() => onComplete(result.user)}>Continue</button>
    </section>;
  }
  return <section className={styles.flow} aria-label="Two-factor verification">
    <h2>{challenge.enrollment ? "Connect your authenticator" : "Enter your verification code"}</h2>
    {challenge.enrollment ? <>
      <p>Add Invoice Checker to your authenticator app by scanning this QR code. You can also enter the setup key manually.</p>
      <Image className={styles.qr} src={challenge.enrollment.qr_code} alt="Authenticator setup QR code" width={220} height={220} unoptimized />
      <details><summary>Enter setup key manually</summary><code className={styles.key}>{challenge.enrollment.secret}</code></details>
    </> : <p>{recovery ? "Enter one of your unused recovery codes." : "Use the six-digit code from your authenticator app."}</p>}
    <form className={styles.flow} onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        const verified = await verifySecondFactor(challenge.challenge_id, code.trim());
        setCode("");
        if (verified.recovery_codes?.length) setResult(verified);
        else onComplete(verified.user);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify that code."); }
      finally { setBusy(false); }
    }}>
      <label className="ic-field">{recovery ? "Recovery code" : "Authenticator code"}<input className="ic-input" type="text" inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" required minLength={6} maxLength={recovery ? 128 : 6} pattern={recovery ? undefined : "[0-9]{6}"} value={code} onChange={event => setCode(event.target.value)} /></label>
      {error ? <p role="alert" className="ic-hint ic-hint--error">{error}</p> : null}
      <p className="ic-hint">This verification expires after five minutes. If it expires, sign in again to continue.</p>
      <button className="ic-btn ic-btn--primary" disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button>
      <div className={styles.actions}>
        {!challenge.enrollment ? <button className="ic-link" type="button" disabled={busy} onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>{recovery ? "Use authenticator instead" : "Use a recovery code"}</button> : null}
        {onCancel ? <button className="ic-link" type="button" disabled={busy} onClick={onCancel}>Back to sign in</button> : null}
      </div>
    </form>
  </section>;
}
