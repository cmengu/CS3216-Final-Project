"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn, signInWithGoogle, signInWithMicrosoft, useUser, type SignInResult } from "@/auth";
import { Icon } from "@/components/icons";

export default function SignIn() {
  const user = useUser();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const finish = (r: SignInResult) => {
    if (r.ok) router.replace("/");
    else setWrong(true);
  };

  return (
    <div className="ic-auth">
      <div className="ic-brand">
        <span className="ic-mark" aria-hidden="true">
          <Icon name="tick" size="ui" />
        </span>
        Invoice Checker
      </div>
      <main className="ic-card">
        <h1>Sign in</h1>
        <form
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            finish(await signIn(email, password));
            setBusy(false);
          }}
        >
          <div className="ic-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="ic-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setWrong(false);
              }}
            />
          </div>
          <div className="ic-field">
            <div className="lblrow">
              <label htmlFor="password" className="lbl">
                Password
              </label>
              {/* TODO(backend): link to the password reset flow once auth exists */}
              <button type="button" className="ic-link" style={{ minHeight: 0, fontSize: 13 }} onClick={() => setForgot(true)}>
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              className={`ic-input${wrong ? " ic-input--error" : ""}`}
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={wrong}
              aria-describedby={wrong ? "pw-error" : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setWrong(false);
              }}
            />
            {wrong ? (
              <p id="pw-error" className="ic-hint ic-hint--error" role="alert">
                Email or password is incorrect.
              </p>
            ) : null}
            {forgot ? (
              <p className="ic-hint" role="status">
                Ask your administrator to reset your password.
              </p>
            ) : null}
          </div>
          <button className="ic-btn ic-btn--primary ic-btn--block" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <div className="ic-or">or</div>
        <button className="ic-btn ic-btn--secondary ic-btn--block" type="button" onClick={async () => finish(await signInWithGoogle())}>
          Continue with Google
        </button>
        <button className="ic-btn ic-btn--secondary ic-btn--block" type="button" onClick={async () => finish(await signInWithMicrosoft())}>
          Continue with Microsoft
        </button>
      </main>
    </div>
  );
}
