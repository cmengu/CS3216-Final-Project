/** One read at a time, coalesced refreshes, and bounded retries while visible. */
export function createReadLoop<T>(options: {
  read: (signal: AbortSignal) => Promise<T>;
  success: (value: T) => void;
  failure: (error: unknown) => void;
  shouldPoll?: () => boolean;
  visible?: () => boolean;
  interval?: number | (() => number);
}) {
  const interval = () => typeof options.interval === "function" ? options.interval() : options.interval ?? 5_000;
  const visible = options.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let refreshPending = false;
  let forcePending = false;
  let failures = 0;
  let retryUntil = 0;
  let nextReadAt = 0;

  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped && visible()) timer = setTimeout(run, Math.min(delay, 2_147_483_647));
  }

  async function run() {
    if (stopped || running || !visible()) return;
    if (retryUntil > Date.now()) { schedule(retryUntil - Date.now()); return; }
    if (!forcePending && nextReadAt > Date.now()) { schedule(nextReadAt - Date.now()); return; }
    running = true;
    refreshPending = false;
    forcePending = false;
    let failed = false;
    const startedAt = Date.now();
    try {
      const value = await options.read(controller.signal);
      if (stopped) return;
      failures = 0;
      retryUntil = 0;
      options.success(value);
      nextReadAt = Date.now() + Math.max(interval(), Math.min(60_000, (Date.now() - startedAt) * 2));
    } catch (error) {
      if (stopped) return;
      failed = true;
      ++failures;
      const supplied = typeof error === "object" && error !== null && "retryAfter" in error ? error.retryAfter : null;
      const delay = Math.max(Math.min(60_000, interval() * 2 ** Math.min(failures - 1, 4)), typeof supplied === "number" && Number.isFinite(supplied) && supplied > 0 ? supplied * 1000 : 0);
      retryUntil = Date.now() + delay;
      options.failure(error);
    } finally {
      running = false;
      if (!stopped) {
        if (failed) schedule(Math.max(0, retryUntil - Date.now()));
        else if (refreshPending) schedule(forcePending ? 0 : Math.max(0, nextReadAt - Date.now()));
        else if (options.shouldPoll?.()) schedule(Math.max(0, nextReadAt - Date.now()));
      }
    }
  }

  return {
    refresh(force = false) {
      if (stopped) return;
      forcePending ||= force;
      if (running) refreshPending = true;
      else schedule(Math.max(0, retryUntil - Date.now(), forcePending ? 0 : nextReadAt - Date.now()));
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
