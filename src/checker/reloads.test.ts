// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadDelay } from "./reloads";

const SLOW_MS = 10_000;
const checkingId = "11111111-1111-1111-1111-111111111111";
const finishedId = "22222222-2222-2222-2222-222222222222";

const row = (id: string, status: string, updatedAt: string) => ({
  id, filename: `${id}.pdf`, status, mode: "live", created_at: "2026-11-06T12:55:46+00:00", updated_at: updatedAt,
  price_sheet_version: "sheet", error: null,
});
const full = (id: string, status: string, updatedAt: string) => ({
  ...row(id, status, updatedAt),
  invoice: null,
  check: status === "completed" ? { overcharge_total: "0.00", lines: [], warnings: [] } : null,
});

/** A plain answer: a real Response reads its body on timers these tests control. */
const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

/** A service that answers every read after `delay`, with one invoice finishing after the first load. */
function slowService(delay: number) {
  const calls = { lists: 0, details: 0, running: 0, mostAtOnce: 0 };
  let failing = false;
  const fetchMock = vi.fn((url: string) => new Promise<Response>((resolve) => {
    const detailed = url.includes("include_details=true");
    if (url.includes("/invoices?")) calls.lists += 1;
    else calls.details += 1;
    if (url.includes("/invoices?")) {
      calls.running += 1;
      calls.mostAtOnce = Math.max(calls.mostAtOnce, calls.running);
    }
    setTimeout(() => {
      if (url.includes("/invoices?")) calls.running -= 1;
      if (failing) return resolve(answer({}, 500));
      const body = url.includes("/invoices?")
        ? detailed
          ? [full(checkingId, "checking", "a"), full(finishedId, "checking", "a")]
          : [row(checkingId, "checking", "a"), row(finishedId, "completed", "b")]
        : full(finishedId, "completed", "b");
      resolve(answer(body));
    }, delay);
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fail: (value: boolean) => { failing = value; } };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Time passes in small steps, because React only applies state when each act() ends. */
async function wait(ms: number) {
  for (let passed = 0; passed < ms; passed += 250) {
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  }
}

let root: Root;
let seen: { invoices: { id: string; state: string }[] | null; error: string | null };

async function mount() {
  vi.resetModules();
  const api = await import("./api");
  function Probe() {
    seen = api.useInvoices();
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  return api;
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setHidden(false);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useInvoices reloads while an invoice is being checked", () => {
  it("never runs two reloads at once when the service is slow", async () => {
    const { calls } = slowService(SLOW_MS);
    await mount();
    await wait(120_000);
    expect(calls.mostAtOnce).toBe(1);
  });

  it("keeps what a slow reload fetched, so a finished invoice is read once", async () => {
    const { calls } = slowService(SLOW_MS);
    await mount();
    await wait(120_000);
    expect(calls.details).toBe(1);
    expect(seen.invoices?.find((invoice) => invoice.id === finishedId)?.state).toBe("checked");
  });

  it("waits longer between reloads when they are slow", async () => {
    const quick = slowService(100);
    await mount();
    await wait(60_000);
    const quickReloads = quick.calls.lists;
    await act(async () => { root.unmount(); });

    const slow = slowService(SLOW_MS);
    await mount();
    await wait(60_000);
    expect(quickReloads).toBeGreaterThan(10);
    expect(slow.calls.lists).toBeLessThanOrEqual(3);
  });

  it("stops while the tab is hidden and catches up when it is shown again", async () => {
    const { calls } = slowService(100);
    await mount();
    await wait(1_000);
    setHidden(true);
    await wait(5_000);
    const whileHidden = calls.lists;
    await wait(60_000);
    expect(calls.lists).toBe(whileHidden);
    setHidden(false);
    await wait(1_000);
    expect(calls.lists).toBeGreaterThan(whileHidden);
  });

  it("keeps trying after a failed reload, and clears the error once it works", async () => {
    const service = slowService(100);
    await mount();
    await wait(1_000);
    service.fail(true);
    await wait(4_000);
    expect(seen.error).not.toBeNull();
    service.fail(false);
    await wait(10_000);
    expect(seen.error).toBeNull();
  });

  it("does not reload on its own once nothing is being checked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([full(finishedId, "completed", "b")])));
    await mount();
    await wait(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts reloading when an upload adds an invoice that is still being checked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([])));
    const api = await mount();
    await wait(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const { toSupplierInvoice } = await import("./convert");
    await act(async () => { api.rememberInvoice(toSupplierInvoice(full(checkingId, "checking", "a") as never)); });
    await wait(10_000);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
  });

  it("answers reloads asked for mid-load with one more reload, not one each", async () => {
    const { calls } = slowService(SLOW_MS);
    const api = await mount();
    await wait(SLOW_MS / 2);
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { api.reloadInvoices(); });
    }
    await wait(SLOW_MS);
    expect(calls.mostAtOnce).toBe(1);
    expect(calls.lists).toBe(2);
  });
});

describe("reloadDelay", () => {
  it("waits 3 seconds after a quick reload, twice the time after a slow one, and at most a minute", () => {
    expect(reloadDelay(200)).toBe(3_000);
    expect(reloadDelay(10_000)).toBe(20_000);
    expect(reloadDelay(45_000)).toBe(60_000);
  });
});
