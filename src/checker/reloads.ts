/** The quickest a page looks again while an invoice is still being checked. */
export const RECHECK_MS = 3_000;
/** The longest a page waits to look again, however slow the service is. */
const MOST_WAIT_MS = 60_000;

/** Twice as long as the last reload took, so a slow service gets room to catch up. */
export function reloadDelay(tookMs: number): number {
  return Math.min(Math.max(RECHECK_MS, tookMs * 2), MOST_WAIT_MS);
}

interface ReloadRules {
  /** One reload. It reports its own failure and never rejects. */
  load: () => Promise<void>;
  /** Whether something is still changing, so the page should look again by itself. */
  keepGoing: () => boolean;
  /** A hidden tab does not look again by itself. Showing it asks for a reload. */
  hidden: () => boolean;
}

/**
 * Runs one reload at a time. The next automatic reload is timed from the end of the last one,
 * never from its start: on a clock, a slow service gets more requests the slower it becomes.
 */
export function startReloads({ load, keepGoing, hidden }: ReloadRules) {
  let running = false;
  let again = false;
  let stopped = false;
  let tookMs = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reload = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    running = true;
    const startedAt = Date.now();
    void load().finally(() => {
      running = false;
      tookMs = Date.now() - startedAt;
      if (again) {
        again = false;
        reload();
      } else {
        settle();
      }
    });
  };

  /** Start waiting for the next reload, if one is needed and none is on its way. */
  const settle = () => {
    if (stopped || running || timer !== undefined || hidden() || !keepGoing()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!hidden() && keepGoing()) reload();
    }, reloadDelay(tookMs));
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };

  return { reload, settle, stop };
}
