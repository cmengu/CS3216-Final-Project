import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSignIn, currentUser, refreshAuthSession, resendSecondFactor, setupAdministrator, signIn, signOut, verifySecondFactor } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpOnly cookie authentication", () => {
  it("authenticates via POST /auth/sign-in with credentials: include, purges legacy localStorage, and never stores provider=password", async () => {
    const localMap = new Map<string, string>([
      ["ic.session.v1", '{"email":"you@company.com","provider":"google"}'],
      ["ic.session.v2", '{"email":"demo-account","provider":"password"}'],
      ["ic.session.id.v1", "old-uuid"],
    ]);
    const sessionMap = new Map<string, string>([["ic.session.id.v1", "old-uuid"]]);
    const localStorage = {
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => void localMap.set(k, v),
      removeItem: (k: string) => void localMap.delete(k),
    };
    const sessionStorage = {
      getItem: (k: string) => sessionMap.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionMap.set(k, v),
      removeItem: (k: string) => void sessionMap.delete(k),
    };
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/sign-in")) {
        expect(init?.credentials).toBe("include");
        if (init?.method === "POST") expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
        return new Response(
          JSON.stringify({
            ok: true,
            session_id: "ic1.signed.token",
            user: { email: "demo-account" },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/auth/me")) {
        expect(init?.credentials).toBe("include");
        if (init?.method === "POST") expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
        return new Response(
          JSON.stringify({
            ok: true,
            authenticated: true,
            session_id: "ic1.signed.token",
            user: { email: "demo-account" },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/auth/sign-out")) {
        expect(init?.credentials).toBe("include");
        if (init?.method === "POST") expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await signIn("demo-account", "invoice-checker");
    expect(res).toEqual({ ok: true, user: { email: "demo-account" } });
    expect(currentUser()).toEqual({ email: "demo-account" });

    // Legacy localStorage keys are completely purged and nothing new is written to localStorage
    expect(localMap.has("ic.session.v1")).toBe(false);
    expect(localMap.has("ic.session.v2")).toBe(false);
    expect(localMap.has("ic.session.id.v1")).toBe(false);
    expect(sessionMap.has("ic.session.id.v1")).toBe(false);

    const verified = await refreshAuthSession();
    expect(verified).toEqual({ email: "demo-account" });

    await signOut();
    expect(currentUser()).toBeNull();
  });
});


it.each(["server rejection", "network failure"])("keeps the user signed in after a sign-out %s so they can retry", async (failure) => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, user: { email: "security-test" } })));
  expect((await signIn("security-test", "test-password")).ok).toBe(true);
  vi.stubGlobal("fetch", failure === "network failure"
    ? vi.fn().mockRejectedValue(new TypeError("offline"))
    : vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
  await expect(signOut()).rejects.toThrow("Couldn’t sign out securely");
  expect(currentUser()).toEqual({ email: "security-test" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  await signOut();
  expect(currentUser()).toBeNull();
});


it("does not authenticate with public demo credentials when the server is unreachable", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  expect(await signIn("demo-account", "invoice-checker")).toEqual({ ok: false, error: "unreachable" });
  expect(currentUser()).toBeNull();
});

it("explains sign-in throttling without reporting successful authentication", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "60" } })));
  const result = await signIn("approved-member", "a-real-test-password");
  expect(result.ok).toBe(false);
  if (!result.ok && result.error === "limited") { expect(result.message).toContain("60"); }
});

it("keeps password-verified email challenges signed out and never stores them", async () => {
  const localStorage = { removeItem: vi.fn(), setItem: vi.fn() };
  vi.stubGlobal("window", { localStorage });
  const challenge = { mfa_required: true, challenge_id: "private-challenge-id-longer-than-32", destination: "m***@example.com", expires_in: 300, resend_after: 60 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(challenge)));
  const result = await signIn("approved-member", "a-real-test-password");
  expect(result).toEqual({ ok: false, error: "two_factor", challenge });
  expect(currentUser()).toBeNull();
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it("activates frontend auth state only after a verified email-code response", async () => {
  vi.stubGlobal("window", {});
  const verified = { user: { email: "approved-member", role: "member" as const } };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(verified));
  vi.stubGlobal("fetch", fetchMock);
  const result = await verifySecondFactor("private-challenge-id-longer-than-32", "123456");
  expect(result).toEqual(verified);
  expect(currentUser()).toBeNull();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/auth/mfa/verify");
  expect(init.credentials).toBe("include");
  expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
  completeSignIn(result.user);
  expect(currentUser()).toEqual(verified.user);
});

it("administrator setup returns a challenge and clears any existing frontend identity", async () => {
  vi.stubGlobal("window", {});
  const challenge = { mfa_required: true, challenge_id: "private-challenge-id-longer-than-32", destination: "a***@example.com", expires_in: 300, resend_after: 60 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(challenge)));
  expect(await setupAdministrator("private-operator-setup-token", "admin", "a-real-test-password")).toEqual(challenge);
  expect(currentUser()).toBeNull();
});


it("resends using only the existing challenge, never a caller-selected email", async () => {
  vi.stubGlobal("window", {});
  const challenge = { mfa_required: true, challenge_id: "replacement-private-challenge-id", destination: "a***@example.com", expires_in: 300, resend_after: 60 };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(challenge));
  vi.stubGlobal("fetch", fetchMock);
  expect(await resendSecondFactor("current-private-challenge-id")).toEqual(challenge);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/auth/mfa/resend");
  expect(JSON.parse(String(init.body))).toEqual({ challenge_id: "current-private-challenge-id" });
  expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
  expect(currentUser()).toBeNull();
});
