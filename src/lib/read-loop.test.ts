import { afterEach, expect, it, vi } from "vitest";
import { createReadLoop } from "./read-loop";
import { ServiceReadError } from "./service-error";

afterEach(() => vi.useRealTimers());

it("coalesces refresh storms and waits for a slow read to finish", async () => {
  vi.useFakeTimers();
  let finish!: (value: number) => void;
  const read = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const success = vi.fn();
  const loop = createReadLoop({ read, success, failure: vi.fn(), shouldPoll: () => true });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 174; i++) loop.refresh();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(1);
  finish(174);
  await vi.advanceTimersByTimeAsync(0);
  expect(success).toHaveBeenCalledWith(174);
  await vi.advanceTimersByTimeAsync(39_999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("backs off after initial failures and recovers without a manual reload", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error("timeout"))
    .mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(174);
  const success = vi.fn();
  const loop = createReadLoop({ read, success, failure: vi.fn() });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(success).toHaveBeenCalledWith(174);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read).toHaveBeenCalledTimes(3);
  loop.stop();
});

it("pauses in a hidden tab and aborts outstanding reads when stopped", async () => {
  vi.useFakeTimers();
  let visible = false;
  let signal!: AbortSignal;
  let finish!: (value: number) => void;
  const success = vi.fn();
  const read = vi.fn((active: AbortSignal) => {
    signal = active;
    return new Promise<number>(resolve => { finish = resolve; });
  });
  const loop = createReadLoop({ read, success, failure: vi.fn(), visible: () => visible });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).not.toHaveBeenCalled();
  visible = true;
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  loop.stop();
  expect(signal.aborted).toBe(true);
  finish(174);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(success).not.toHaveBeenCalled();
});

it("caps retries at one per minute during a sustained outage", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValue(new Error("unavailable"));
  const loop = createReadLoop({ read, success: vi.fn(), failure: vi.fn() });
  loop.refresh();
  // Attempts at 0, 5, 15, 35, 75, 135, and 195 seconds.
  await vi.advanceTimersByTimeAsync(195_000);
  expect(read).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(read).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(8);
  loop.stop();
});

it("honors server cooldowns even when focus and refresh events keep firing", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new ServiceReadError("Busy", 120)).mockResolvedValue(174);
  const loop = createReadLoop({ read, success: vi.fn(), failure: vi.fn() });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 174; i++) loop.refresh();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("keeps ordinary focus refreshes within the healthy polling cadence", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(10_000);
  const loop = createReadLoop({ read, success: vi.fn(), failure: vi.fn(), interval: 200_000 });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 100; i++) {
    loop.refresh();
    await vi.advanceTimersByTimeAsync(1_000);
  }
  expect(read).toHaveBeenCalledOnce();
  loop.refresh(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("does not turn a long cooldown into an immediate retry through timer overflow", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new ServiceReadError("Busy", 2_147_484)).mockResolvedValue(174);
  const loop = createReadLoop({ read, success: vi.fn(), failure: vi.fn() });
  loop.refresh();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2_147_483_647);
  expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(353);
  expect(read).toHaveBeenCalledTimes(2);
  loop.stop();
});
