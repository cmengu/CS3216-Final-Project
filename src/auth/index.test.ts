import { afterEach, describe, expect, it, vi } from "vitest";
import { beginPasswordReset, completePasswordReset, resendPasswordResetEmail, verifyPasswordResetEmail, beginAccountEnrollment, completeAccountEnrollment, resendEnrollmentEmail, verifyEnrollmentEmail, beginAdministratorSetup, completeSignIn, currentUser, refreshAuthSession, resendSecondFactor, setupAdministrator, signIn, signOut, verifyAdministratorEmail, verifySecondFactor } from "./index";

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

it("administrator setup starts with an email challenge and no submitted password", async () => {
  vi.stubGlobal("window", {});
  const challenge = { mfa_required: true, challenge_id: "private-challenge-id-longer-than-32", destination: "a***@example.com", expires_in: 300, resend_after: 60 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(challenge)));
  expect(await beginAdministratorSetup()).toEqual(challenge);
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


it("email proof for setup does not sign the user in before password creation", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ setup_grant: "verified-private-setup-grant" })));
  expect(await verifyAdministratorEmail("private-challenge-id", "123456")).toEqual({ setup_grant: "verified-private-setup-grant" });
  expect(currentUser()).toBeNull();
});

it("creates the administrator only using a verified setup grant", async () => {
  vi.stubGlobal("window", {});
  const user = { email: "chosen-admin", role: "admin" as const };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ user }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await setupAdministrator("verified-private-setup-grant", "chosen-admin", "a-real-test-password")).toEqual(user);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/auth/setup/complete");
  expect(JSON.parse(String(init.body))).toEqual({ setup_grant: "verified-private-setup-grant", username: "chosen-admin", password: "a-real-test-password" });
  expect(currentUser()).toEqual(user);
});


it("approved-member email proof does not sign in or persist setup credentials", async () => {
  const localStorage = { removeItem: vi.fn(), setItem: vi.fn() };
  vi.stubGlobal("window", { localStorage });
  const challenge = { mfa_required: true, challenge_id: "private-enrollment-challenge", destination: "m***@example.com", expires_in: 300, resend_after: 60 };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.credentials).toBe("include");
    return Response.json(url.endsWith("/auth/enroll/verify") ? { setup_grant: "private-enrollment-proof" } : url.endsWith("/auth/enroll/start") ? challenge : []);
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await beginAccountEnrollment("member@example.com")).toEqual(challenge);
  expect(currentUser()).toBeNull();
  expect(await verifyEnrollmentEmail(challenge.challenge_id, "123456")).toEqual({ setup_grant: "private-enrollment-proof" });
  expect(currentUser()).toBeNull();
  expect(localStorage.setItem).not.toHaveBeenCalled();
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({ email: "member@example.com" });
  expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
});

it("enrollment resends with its challenge and creates credentials only with verified proof", async () => {
  vi.stubGlobal("window", {});
  const user = { email: "chosen-member", role: "member" as const };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ challenge_id: "replacement-proof" })).mockResolvedValueOnce(Response.json({ user }));
  vi.stubGlobal("fetch", fetchMock);
  await resendEnrollmentEmail("private-enrollment-challenge");
  const [resendUrl, resendInit] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(resendUrl).toContain("/auth/enroll/resend");
  expect(JSON.parse(String(resendInit.body))).toEqual({ challenge_id: "private-enrollment-challenge" });
  expect(await completeAccountEnrollment("private-enrollment-proof", "chosen-member", "a-real-test-password")).toEqual(user);
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toContain("/auth/enroll/complete");
  expect(JSON.parse(String(init.body))).toEqual({ setup_grant: "private-enrollment-proof", username: "chosen-member", password: "a-real-test-password" });
  expect(currentUser()).toEqual(user);
});


it("password reset proves only the registered email without signing in or persisting proof", async () => {
  const localStorage = { removeItem: vi.fn(), setItem: vi.fn() };
  vi.stubGlobal("window", { localStorage });
  const before = currentUser();
  const challenge = { mfa_required: true, challenge_id: "private-reset-challenge", destination: "m***@example.com", expires_in: 300, resend_after: 60 };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.credentials).toBe("include");
    expect(init?.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
    return Response.json(url.endsWith("/auth/password-reset/verify") ? { reset_grant: "private-reset-proof" } : challenge);
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await beginPasswordReset("member@example.com")).toEqual(challenge);
  expect(await verifyPasswordResetEmail(challenge.challenge_id, "123456")).toEqual({ reset_grant: "private-reset-proof" });
  expect(currentUser()).toEqual(before);
  expect(localStorage.setItem).not.toHaveBeenCalled();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: "member@example.com" });
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ challenge_id: challenge.challenge_id, code: "123456" });
});

it("password reset resends with its existing challenge and signs out only after completion", async () => {
  vi.stubGlobal("window", {});
  const before = currentUser();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/auth/password-reset/resend")) return Response.json({ challenge_id: "replacement-reset-challenge" });
    if (url.endsWith("/auth/password-reset/complete")) {
      expect(JSON.parse(String(init?.body))).toEqual({ reset_grant: "verified-reset-proof", new_password: "a-private-replacement-password" });
      return Response.json({ ok: true });
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  await resendPasswordResetEmail("private-reset-challenge");
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ challenge_id: "private-reset-challenge" });
  expect(currentUser()).toEqual(before);
  await completePasswordReset("verified-reset-proof", "a-private-replacement-password");
  expect(currentUser()).toBeNull();
});

it("a rejected password reset preserves existing frontend authentication", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
  completeSignIn({ email: "existing-user", role: "member" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "Email verification expired" }, { status: 401 })));
  await expect(completePasswordReset("expired-reset-proof", "a-private-replacement-password")).rejects.toThrow("Email verification expired");
  expect(currentUser()).toEqual({ email: "existing-user", role: "member" });
});
