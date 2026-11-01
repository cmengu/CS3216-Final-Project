"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn, useUser, type SignInResult } from "@/auth";
import { Icon } from "@/components/icons";
import { useMasterList } from "@/masterList";

export default function SignIn() {
  const user = useUser();
  const ml = useMasterList();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const nextRoute = ml === null ? "/master-list" : "/invoices";

  useEffect(() => {
    if (user && ml !== undefined) router.replace(nextRoute);
  }, [user, ml, nextRoute, router]);

  const finish = (r: SignInResult) => {
    if (r.ok) router.replace(nextRoute);
    else setWrong(true);
  };

  return (
    <div className="ic-auth">
      <Link className="ic-brand" href="/">
        <span className="ic-mark" aria-hidden="true">
          <Icon name="tick" size="ui" />
        </span>
        Invoice Checker
      </Link>
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
