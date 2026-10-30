import { afterEach, describe, expect, it, vi } from "vitest";
import { currentUser, refreshAuthSession, signIn, signOut } from "./index";

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
  if (!result.ok) { expect(result.error).toBe("limited"); expect(result.message).toContain("60"); }
});
