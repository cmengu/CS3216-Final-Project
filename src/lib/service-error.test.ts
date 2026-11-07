import { afterEach, expect, it, vi } from "vitest";
import { retryAfterSeconds } from "./service-error";

afterEach(() => vi.useRealTimers());

it.each([["60", 60], ["0", 1], ["0.5", 1], ["-1", null], ["", null], ["invalid", null]] as const)("parses Retry-After %s safely", (header, expected) => {
  expect(retryAfterSeconds(new Response("", { headers: { "Retry-After": header } }))).toBe(expected);
});

it("accepts HTTP-date Retry-After values", () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-11-07T00:00:00Z");
  expect(retryAfterSeconds(new Response("", { headers: { "Retry-After": "Sat, 07 Nov 2026 00:02:00 GMT" } }))).toBe(120);
  expect(retryAfterSeconds(new Response(""))).toBeNull();
});
