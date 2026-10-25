/*
 * Sign-in backed by POST /auth/sign-in (configured via AUTH_USERNAME and AUTH_PASSWORD in backend/.env).
 */
"use client";

import { useSyncExternalStore } from "react";
import { SERVICE_URL, SESSION_ID_KEY, setActiveSessionId } from "@/checker/api";
import { resetUploadsSession } from "@/checker/uploads";
import { resetMasterListSession } from "@/masterList";

export interface User {
  email: string;
  provider: "password" | "google" | "microsoft";
}

export type SignInResult = { ok: true; user: User } | { ok: false; error: "invalid" };

const KEY = "ic.session.v2";
const DEFAULT_USERNAME = process.env.NEXT_PUBLIC_AUTH_USERNAME ?? "demo-account";
const DEFAULT_PASSWORD = process.env.NEXT_PUBLIC_AUTH_PASSWORD ?? "invoice-checker";
const listeners = new Set<() => void>();
let cached: { raw: string | null; user: User | null } = { raw: null, user: null };

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function store(user: User | null, sessionId?: string | null) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  setActiveSessionId(user ? (sessionId ?? newSessionId()) : null);
  resetUploadsSession();
  resetMasterListSession();
  listeners.forEach((l) => l());
}

/** The person signed in, or null. */
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

export async function signIn(username: string, password: string): Promise<SignInResult> {
  const trimmed = username.trim();
  if (!trimmed || !password) return { ok: false, error: "invalid" };

  try {
    const resp = await fetch(`${SERVICE_URL}/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: trimmed, password }),
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; user?: User; session_id?: string };
      if (data.ok && data.user) {
        store(data.user, data.session_id ?? newSessionId());
        return { ok: true, user: data.user };
      }
    }
    return { ok: false, error: "invalid" };
  } catch {
    // Fallback if backend is unreachable (e.g., offline frontend test environment)
    if (trimmed.toLowerCase() === DEFAULT_USERNAME.toLowerCase() && password === DEFAULT_PASSWORD) {
      const user: User = { email: DEFAULT_USERNAME, provider: "password" };
      store(user, newSessionId());
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
  store(null, null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === SESSION_ID_KEY) l();
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
