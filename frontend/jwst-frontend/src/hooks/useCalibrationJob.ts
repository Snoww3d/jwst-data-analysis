/**
 * Lean polling hook for calibration jobs (#1709 PR 8).
 *
 * Deliberately NOT a retrofit of useJobProgress — that hook is coupled to
 * SignalR + the .NET import-job shape. Calibration jobs live on the Python
 * engine and change state on the order of seconds, so plain polling of
 * GET /api/jobs/{id} is the right tool (ADR-0001 divergence, documented).
 */

import { useEffect, useRef, useState } from 'react';
import { getJob } from '../services/calibrationService';
import type { CalibrationJob } from '../types/CalibrationTypes';
import { TERMINAL_JOB_STATUSES } from '../types/CalibrationTypes';

const POLL_INTERVAL_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 5;

export interface UseCalibrationJobResult {
  job: CalibrationJob | null;
  isTerminal: boolean;
  error: string | null;
}

interface Snapshot {
  key: string | null;
  job: CalibrationJob | null;
  error: string | null;
}

export function useCalibrationJob(jobId: string | null): UseCalibrationJobResult {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: jobId,
    job: null,
    error: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset during render when the job id changes (React's documented
  // derived-state pattern) — avoids a synchronous setState inside the effect.
  if (snapshot.key !== jobId) {
    setSnapshot({ key: jobId, job: null, error: null });
  }

  useEffect(() => {
    if (!jobId) return undefined;

    let cancelled = false;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        const next = await getJob<CalibrationJob>(jobId);
        if (cancelled) return;
        consecutiveFailures = 0;
        setSnapshot({ key: jobId, job: next, error: null });
        if ((TERMINAL_JOB_STATUSES as readonly string[]).includes(next.status)) {
          return; // done — stop polling
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // Tolerate transient failures, but stop on a persistently missing
        // job (e.g. an evicted/invalid id) instead of polling forever.
        consecutiveFailures += 1;
        const message = err instanceof Error ? err.message : 'Failed to fetch job';
        setSnapshot((prev) => (prev.key === jobId ? { ...prev, error: message } : prev));
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId]);

  const job = snapshot.key === jobId ? snapshot.job : null;
  const error = snapshot.key === jobId ? snapshot.error : null;
  const isTerminal =
    job !== null && (TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status);
  return { job, isTerminal, error };
}
