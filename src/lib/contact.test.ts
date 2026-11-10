import { afterEach, describe, expect, it, vi } from "vitest";
import { contactFailure, sendContact } from "./contact";

const FORM = { name: "Mai Tran", email: "mai@example.com", company: "Harbour Hotel", message: "We check 300 invoices a month.", website: "" };

afterEach(() => vi.unstubAllGlobals());

describe("sendContact", () => {
  it("posts the form as JSON with the protection header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "sent" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendContact(FORM);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/contact")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual(FORM);
  });

  it("turns a refusal into a plain sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "120" } })));
    await expect(sendContact(FORM)).rejects.toThrow("Too many messages from here. Try again in 2 minutes.");
  });

  it("says when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(sendContact(FORM)).rejects.toThrow("We couldn't reach our server.");
  });
});

describe("contactFailure", () => {
  it("explains invalid fields and unavailable delivery", () => {
    expect(contactFailure(422)).toMatch(/valid email/);
    expect(contactFailure(503)).toMatch(/right now/);
    expect(contactFailure(429, "30")).toBe("Too many messages from here. Try again in 1 minute.");
  });
});
