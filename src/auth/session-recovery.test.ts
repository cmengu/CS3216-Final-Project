import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });

async function freshAuth() {
  vi.resetModules();
  vi.stubGlobal("window", {});
  return import("./index");
}

describe("session recovery during service delays", () => {
  it.each(["network", "gateway"])("keeps an unverified session pending after a %s failure", async (failure) => {
    const auth = await freshAuth();
    vi.stubGlobal("fetch", failure === "network"
      ? vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError"))
      : vi.fn().mockResolvedValue(new Response("Gateway unavailable", { status: 502 })));
    await auth.refreshAuthSession();
    expect(auth.currentUser()).toBeUndefined();
    expect(auth.currentSessionError()).toContain("connection is slow");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ authenticated: true, user: { email: "member" } })));
    await auth.refreshAuthSession();
    expect(auth.currentUser()).toEqual({ email: "member" });
    expect(auth.currentSessionError()).toBeNull();
  });

  it("preserves a verified user when the connection drops", async () => {
    const auth = await freshAuth();
    auth.completeSignIn({ email: "member" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    await auth.refreshAuthSession();
    expect(auth.currentUser()).toEqual({ email: "member" });
  });

  it.each([401, 403])("clears a session rejected by the server (HTTP %s)", async (status) => {
    const auth = await freshAuth();
    auth.completeSignIn({ email: "member" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await auth.refreshAuthSession();
    expect(auth.currentUser()).toBeNull();
    expect(auth.currentSessionError()).toBeNull();
  });

  it("ignores an old session rejection that arrives after successful sign-in", async () => {
    const auth = await freshAuth();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => url.endsWith("/auth/me")
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(Response.json(null))));
    const pending = auth.refreshAuthSession();
    auth.completeSignIn({ email: "member" });
    finish(new Response("{}", { status: 401 }));
    await pending;
    expect(auth.currentUser()).toEqual({ email: "member" });
  });

  it("explains a sign-in timeout without reporting invalid credentials", async () => {
    const auth = await freshAuth();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    expect(await auth.signIn("member", "private-password")).toMatchObject({
      ok: false, error: "unreachable", message: expect.stringContaining("took too long"),
    });
  });

  it.each([500, 502, 503, 504])("treats HTTP %s as service failure", async (status) => {
    const auth = await freshAuth();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service error", { status })));
    expect(await auth.signIn("member", "private-password")).toMatchObject({ ok: false, error: "unreachable" });
  });
});
