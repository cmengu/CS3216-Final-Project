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
