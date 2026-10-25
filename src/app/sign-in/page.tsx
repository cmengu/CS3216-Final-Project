"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn, useUser, type SignInResult } from "@/auth";
import { Icon } from "@/components/icons";

export default function SignIn() {
  const user = useUser();
  const router = useRouter();
  const [username, setUsername] = useState("");
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
            finish(await signIn(username, password));
            setBusy(false);
          }}
        >
          <div className="ic-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className={`ic-input${wrong ? " ic-input--error" : ""}`}
              type="text"
              autoComplete="username"
              placeholder="demo-account"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setWrong(false);
              }}
            />
          </div>
          <div className="ic-field">
            <div className="lblrow">
              <label htmlFor="password" className="lbl">
                Password
              </label>
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
                Username or password is incorrect.
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
      </main>
    </div>
  );
}
