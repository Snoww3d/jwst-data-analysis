import { useEffect, useRef, useState } from 'react';

/**
 * Simulated smooth progress that interpolates between real SignalR updates.
 *
 * - Snaps to the real value whenever it jumps ahead.
 * - Slowly climbs toward a target ceiling (default 90%) when idle.
 * - Jumps to 100 on completion, resets to 0 when inactive.
 *
 * @param active  Whether the operation is in progress.
 * @param complete Whether the operation has completed.
 * @param realProgress The latest real progress value (0-100).
 * @returns The display-ready progress percentage (integer 0-100).
 */
export function useSimulatedProgress(
  active: boolean,
  complete: boolean,
  realProgress: number
): number {
  // Timer-driven state — only updated via setInterval callback
  const [timerProgress, setTimerProgress] = useState(0);
  const prevActiveRef = useRef(active);

  // Reset timer progress when operation starts/stops
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    if (active && !wasActive) {
      // Starting — reset to 0
      setTimerProgress(0); // eslint-disable-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    }
  }, [active]);

  // Smooth interpolation timer — climb toward 90%
  useEffect(() => {
    if (!active || complete) return;
    const timer = setInterval(() => {
      setTimerProgress((prev) => {
        const target = 90;
        const remaining = target - prev;
        if (remaining <= 0.5) return prev;
        return prev + remaining * 0.03;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [active, complete]);

  // Derive the final value during render (no setState needed)
  if (!active) return 0;
  if (complete) return 100;
  // Take the max of timer-driven progress and real progress
  return Math.round(Math.max(timerProgress, realProgress));
}
