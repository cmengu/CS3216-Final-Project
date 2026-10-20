/*
 * Sign-in. The checking service has no auth yet, so this is a stub that keeps a session in the
 * browser. Screens use only these functions, so real auth can replace this file.
 *
 * Stub rules: any non-empty email and password signs in; the password "wrong" is refused, so the
 * incorrect-credentials state can be tested.
 */
"use client";

import { useSyncExternalStore } from "react";

export interface User {
  email: string;
  provider: "password" | "google" | "microsoft";
}

export type SignInResult = { ok: true; user: User } | { ok: false; error: "invalid" };

const KEY = "ic.session.v1";
const listeners = new Set<() => void>();
let cached: { raw: string | null; user: User | null } = { raw: null, user: null };

function store(user: User | null) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

/** The person signed in, or null. */
// TODO(backend): replace with GET /auth/session (or read the session cookie)
export function currentUser(): User | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cached.raw) {
    try {
      cached = { raw, user: raw ? (JSON.parse(raw) as User) : null };
    } catch {
      cached = { raw, user: null };
    }
  }
  return cached.user;
}

// TODO(backend): replace with POST /auth/sign-in { email, password }
export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!email.trim() || !password || password === "wrong") return { ok: false, error: "invalid" };
  const user: User = { email: email.trim(), provider: "password" };
  store(user);
  return { ok: true, user };
}

// TODO(backend): replace with the Google OAuth redirect (GET /auth/google)
export async function signInWithGoogle(): Promise<SignInResult> {
  const user: User = { email: "you@company.com", provider: "google" };
  store(user);
  return { ok: true, user };
}

// TODO(backend): replace with the Microsoft OAuth redirect (GET /auth/microsoft)
export async function signInWithMicrosoft(): Promise<SignInResult> {
  const user: User = { email: "you@company.com", provider: "microsoft" };
  store(user);
  return { ok: true, user };
}

// TODO(backend): replace with POST /auth/sign-out
export async function signOut(): Promise<void> {
  store(null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** The signed-in person, kept current. Undefined until the browser has read the session. */
export function useUser(): User | null | undefined {
  return useSyncExternalStore(subscribe, currentUser, () => undefined);
}
