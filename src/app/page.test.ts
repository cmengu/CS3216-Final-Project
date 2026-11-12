import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A session that is already known to be signed in. The landing page must not react to it:
// swapping the header once the session arrived made "Sign in" vanish a moment after load.
vi.mock("@/auth", () => ({
  useUser: () => ({ email: "clerk@example.com", role: "member" }),
}));

const { default: LandingPage } = await import("./page");

describe("landing page header", () => {
  it("shows Sign in whatever the session, so nothing changes after load", () => {
    const html = renderToString(createElement(LandingPage));

    expect(html).toContain('class="lp-nav-signin" href="/sign-in">Sign in</a>');
    expect(html).not.toContain("Open workspace");
  });
});
