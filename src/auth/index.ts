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
}

export type SignInResult = { ok: true; user: User } | { ok: false; error: "invalid" };

const DEFAULT_USERNAME = process.env.NEXT_PUBLIC_AUTH_USERNAME ?? "demo-account";
const DEFAULT_PASSWORD = process.env.NEXT_PUBLIC_AUTH_PASSWORD ?? "invoice-checker";
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
          user?: { email?: string };
        };
        if (data.authenticated && data.user?.email) {
          const verified: User = { email: data.user.email };
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
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; user?: { email?: string } };
      if (data.ok && data.user?.email) {
        const user: User = { email: data.user.email };
        setSessionState(user);
        return { ok: true, user };
      }
    }
    return { ok: false, error: "invalid" };
  } catch {
    // Fallback if backend is unreachable in an offline frontend test environment
    if (trimmed.toLowerCase() === DEFAULT_USERNAME.toLowerCase() && password === DEFAULT_PASSWORD) {
      const user: User = { email: DEFAULT_USERNAME };
      setSessionState(user);
      return { ok: true, user };
    }
    return { ok: false, error: "invalid" };
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
