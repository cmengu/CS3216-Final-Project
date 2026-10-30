"use client";

import { SERVICE_URL, sessionHeaders } from "@/checker/api";

export interface ApprovedAccount {
  id: string;
  username: string;
  role: "admin" | "member";
  active: boolean;
  created_at: number;
}

export async function accountRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...options, credentials: "include", cache: "no-store",
    headers: sessionHeaders(options.body ? { "Content-Type": "application/json" } : undefined, !!options.method && options.method !== "GET"),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "The account change could not be saved. Try again.");
  return body as T;
}
