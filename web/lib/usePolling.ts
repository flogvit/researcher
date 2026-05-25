import { useEffect } from 'react';

/**
 * Run `fn` on an interval, but pause while the tab is hidden (#48).
 *
 * The web UI previously kept polling at 5s in every background tab, so a
 * researcher with 4 tabs open did 4× the admin-DB hits every interval.
 * This hook:
 *   - runs `fn` immediately on mount (skipped if document.hidden at mount)
 *   - sets up an interval that only fires while document is visible
 *   - fires `fn` once on visibility-regained to refresh stale data
 *
 * Tradeoff: when the tab comes back into the foreground we deliberately
 * re-fetch even if we polled <intervalMs ago. The dashboard wants to look
 * up-to-date as soon as the user looks at it.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number): void {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        // Skip work; reschedule and wait for visibility event to fire it.
        timer = setTimeout(tick, intervalMs);
        return;
      }
      Promise.resolve(fn()).finally(() => {
        if (!cancelled) timer = setTimeout(tick, intervalMs);
      });
    };

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
