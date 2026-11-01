/*
 * Sign-in backed by POST /auth/sign-in and verified via GET /auth/me using an HttpOnly session cookie (ic_session).
 */
"use client";

import { useSyncExternalStore } from "react";
import { SERVICE_URL, SESSION_ID_KEY, sessionHeaders, setActiveSessionId } from "@/checker/api";
import { resetUploadsSession } from "@/checker/uploads";
import { resetMasterListSession } from "@/masterList";

export interface User {
  email: string;
  id?: string;
  role?: "admin" | "member";
}

export interface TwoFactorChallenge {
  mfa_required: true;
  challenge_id: string;
  destination: string;
  expires_in: number;
  resend_after: number;
}

export interface TwoFactorResult { user: User }

export type SignInResult = { ok: true; user: User } | { ok: false; error: "two_factor"; challenge: TwoFactorChallenge } | { ok: false; error: "invalid" | "unreachable" | "limited"; message?: string };

const listeners = new Set<() => void>();

let sessionUser: User | null | undefined = undefined;
let checkingSession: Promise<User | null> | null = null;

function purgeLegacyStorage() {
  if (typeof window === "undefined") return;
  for (const key of ["ic.session.v1", "ic.session.v2", SESSION_ID_KEY]) {
    try {
      window.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      window.sessionStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function setSessionState(user: User | null) {
  purgeLegacyStorage();
  sessionUser = user;
  setActiveSessionId(null);
  resetUploadsSession();
  resetMasterListSession();
  listeners.forEach((l) => l());
}

/** Verify the browser's HttpOnly ic_session cookie against GET /auth/me. */
export async function refreshAuthSession(): Promise<User | null> {
  if (typeof window === "undefined") return null;
  purgeLegacyStorage();
  if (checkingSession) return checkingSession;

  let pending: Promise<User | null> | null = null;
  pending = (async () => {
    try {
      const resp = await fetch(`${SERVICE_URL}/auth/me`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          ok?: boolean;
          authenticated?: boolean;
          user?: User;
        };
        if (data.authenticated && data.user?.email) {
          const verified: User = data.user;
          sessionUser = verified;
          listeners.forEach((l) => l());
          return verified;
        }
      }
      sessionUser = null;
      listeners.forEach((l) => l());
      return null;
    } catch {
      if (sessionUser === undefined) {
        sessionUser = null;
        listeners.forEach((l) => l());
      }
      return sessionUser ?? null;
    } finally {
      if (checkingSession === pending) {
        checkingSession = null;
      }
    }
  })();

  checkingSession = pending;
  return pending;
}

/** The person signed in, null when signed out, or undefined while checking the session cookie. */
export function currentUser(): User | null | undefined {
  if (typeof window === "undefined") return undefined;
  return sessionUser;
}

export async function signIn(username: string, password: string): Promise<SignInResult> {
  const trimmed = username.trim();
  if (!trimmed || !password) return { ok: false, error: "invalid" };

  try {
    const resp = await fetch(`${SERVICE_URL}/auth/sign-in`, {
      method: "POST",
      credentials: "include",
      headers: sessionHeaders({ "Content-Type": "application/json" }, true),
      body: JSON.stringify({ username: trimmed, password }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; user?: User } & Partial<TwoFactorChallenge>;
      if (data.mfa_required && data.challenge_id) {
        setSessionState(null);
        return { ok: false, error: "two_factor", challenge: data as TwoFactorChallenge };
      }
      if (data.ok && data.user?.email) {
        const user: User = data.user;
        setSessionState(user);
        return { ok: true, user };
      }
    }
    if (resp.status === 429) {
      const retry = resp.headers.get("Retry-After");
      return { ok: false, error: "limited", message: `Too many sign-in attempts. ${retry ? `Try again in ${retry} seconds.` : "Please wait and try again."}` };
    }
    return { ok: false, error: "invalid" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export async function signInWithGoogle(): Promise<SignInResult> {
  return { ok: false, error: "invalid" };
}

export async function signInWithMicrosoft(): Promise<SignInResult> {
  return { ok: false, error: "invalid" };
}

export async function signOut(): Promise<void> {
  try {
    const response = await fetch(`${SERVICE_URL}/auth/sign-out`, {
      method: "POST",
      credentials: "include",
      headers: sessionHeaders(undefined, true),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Sign-out failed");
  } catch {
    throw new Error("Couldn’t sign out securely. Check the connection and try again.");
  }
  setSessionState(null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (typeof window !== "undefined" && sessionUser === undefined && !checkingSession) {
    void refreshAuthSession();
  }
  return () => {
    listeners.delete(l);
  };
}

/** The signed-in person, kept current. Undefined until the browser has verified the session cookie. */
export function useUser(): User | null | undefined {
  return useSyncExternalStore(subscribe, currentUser, () => undefined);
}


export async function beginAdministratorSetup(): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  const result = await accountRequest<TwoFactorChallenge>("/auth/setup/start", { method: "POST" });
  setSessionState(null);
  return result;
}

export async function verifyAdministratorEmail(challengeId: string, code: string): Promise<{ setup_grant: string }> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/setup/verify", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code }) });
}

export async function resendAdministratorEmail(challengeId: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/setup/resend", { method: "POST", body: JSON.stringify({ challenge_id: challengeId }) });
}

export async function setupAdministrator(grant: string, username: string, password: string): Promise<User> {
  const { accountRequest } = await import("./accounts");
  const result = await accountRequest<{ user: User }>("/auth/setup/complete", { method: "POST", body: JSON.stringify({ setup_grant: grant, username, password }) });
  setSessionState(result.user);
  return result.user;
}

export async function beginAccountEnrollment(email: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  const result = await accountRequest<TwoFactorChallenge>("/auth/enroll/start", { method: "POST", body: JSON.stringify({ email }) });
  setSessionState(null);
  return result;
}

export async function verifyEnrollmentEmail(challengeId: string, code: string): Promise<{ setup_grant: string }> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/enroll/verify", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code }) });
}

export async function resendEnrollmentEmail(challengeId: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/enroll/resend", { method: "POST", body: JSON.stringify({ challenge_id: challengeId }) });
}

export async function completeAccountEnrollment(grant: string, username: string, password: string): Promise<User> {
  const { accountRequest } = await import("./accounts");
  const result = await accountRequest<{ user: User }>("/auth/enroll/complete", { method: "POST", body: JSON.stringify({ setup_grant: grant, username, password }) });
  setSessionState(result.user);
  return result.user;
}

export async function verifySecondFactor(challengeId: string, code: string): Promise<TwoFactorResult> {
  const { accountRequest } = await import("./accounts");
  return accountRequest<TwoFactorResult>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code }) });
}

export async function resendSecondFactor(challengeId: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  return accountRequest<TwoFactorChallenge>("/auth/mfa/resend", { method: "POST", body: JSON.stringify({ challenge_id: challengeId }) });
}

export function completeSignIn(user: User): void { setSessionState(user); }

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { accountRequest } = await import("./accounts");
  await accountRequest("/auth/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
  setSessionState(null);
}


export async function beginPasswordReset(email: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/password-reset/start", { method: "POST", body: JSON.stringify({ email }) });
}

export async function verifyPasswordResetEmail(challengeId: string, code: string): Promise<{ reset_grant: string }> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/password-reset/verify", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code }) });
}

export async function resendPasswordResetEmail(challengeId: string): Promise<TwoFactorChallenge> {
  const { accountRequest } = await import("./accounts");
  return accountRequest("/auth/password-reset/resend", { method: "POST", body: JSON.stringify({ challenge_id: challengeId }) });
}

export async function completePasswordReset(grant: string, newPassword: string): Promise<void> {
  const { accountRequest } = await import("./accounts");
  await accountRequest("/auth/password-reset/complete", { method: "POST", body: JSON.stringify({ reset_grant: grant, new_password: newPassword }) });
  setSessionState(null);
}
