/**
 * Tracks in-flight MAST import jobs for the global header progress pill.
 *
 * Anonymous users get an inert empty state — no network calls, no
 * subscriptions. Authenticated users: seeds from GET
 * /api/mast/import/resumable (via `mastService.getResumableImports`) on
 * mount and on auth change, then subscribes to live progress per job
 * (SignalR-first, HTTP-polling fallback) reusing `subscribeToJobProgress`
 * from `useJobProgress` — no reimplementation of that transport logic.
 *
 * New jobs started elsewhere in the app (MastSearch, WhatsNewPanel) call
 * the returned `registerJob(jobId, obsId?, label?)` to start tracking them
 * immediately, without waiting for the next resumable-jobs poll. A single
 * shared instance of this hook lives in `ActiveImportsProvider`
 * (src/context/ActiveImportsContext.tsx) so all consumers (the pill,
 * MastSearch, WhatsNewPanel) see the same job list instead of each running
 * their own duplicate set of subscriptions.
 *
 * Deliberate redundancy — do not "optimize" away:
 *  - Every job ends up with TWO independent `subscribeToJobProgress`
 *    subscriptions: one owned by the component that started it (MastSearch's
 *    own `useJobProgress`/`ImportProgress` modal, WhatsNewPanel's modal) and
 *    one owned by this hook via `registerJob`. They're separate listeners on
 *    the same jobId, not shared state, so there's no risk of them fighting —
 *    the component UI keeps its own detailed progress view, this hook keeps
 *    the header pill + toast independent of whether that component is still
 *    mounted (e.g. user navigated away from /archive mid-import).
 *  - `/archive` fetches GET /api/mast/import/resumable TWICE on mount: once
 *    here (to seed the pill) and once in MastSearch (to populate the
 *    "Incomplete Downloads" panel with resume/dismiss actions). Cheap,
 *    cacheable GET; not worth coupling two independent UI surfaces over.
 *
 * Toast aggregation is best-effort, not exact-once-per-bulk-operation:
 * `registerJob` only tracks a job from the moment it's called, and
 * MastSearch's bulk import path (MAX_CONCURRENT_IMPORTS = 3) registers jobs
 * in waves — later jobs in a >3-selection batch aren't registered until
 * earlier ones finish. That means the active set can legitimately empty out
 * mid-batch (wave 1 all completes before wave 2 starts), producing more than
 * one aggregated toast for what the user perceives as a single bulk import.
 * This is an accepted tradeoff, not a bug: getting it exactly right would
 * require MastSearch to tell this hook "N jobs incoming" up front, which
 * couples the two more tightly than the win is worth. What IS guaranteed:
 * no toast fires while there's a still-active job, and a job failing never
 * strands or drops the count of jobs that already succeeded (see the
 * onFailed flush in `flushBatchToastIfEmpty`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { mastService } from '../services/mastService';
import { subscribeToJobProgress } from './useJobProgress';
import { toast } from '../components/ui/toast';
import type { ImportJobStatus } from '../types/MastTypes';

/** How long a completed job stays in the list (success flash) before it drops out. */
const COMPLETION_DISPLAY_MS = 2500;

/** Terminal resumable-job states that should not be re-tracked as "active". */
const TERMINAL_RESUMABLE_STATUSES = new Set(['complete', 'completed', 'failed', 'cancelled']);

export type ActiveImportJobStatus = 'starting' | 'running' | 'complete';

export interface ActiveImportJob {
  jobId: string;
  obsId?: string;
  label?: string;
  percent: number;
  status: ActiveImportJobStatus;
}

export interface UseActiveImportsResult {
  jobs: ActiveImportJob[];
  aggregatePercent: number;
  activeCount: number;
  /** Start tracking a newly-launched import job. No-op if already tracked. */
  registerJob: (jobId: string, obsId?: string, label?: string) => void;
}

export function useActiveImports(): UseActiveImportsResult {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Map<string, ActiveImportJob>>(() => new Map());

  // Imperative subscriptions and pending flash-timeout timers, keyed by jobId.
  // Refs (not state) — they're bookkeeping for cleanup, not render inputs.
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Tracks jobs that are registered but not yet completed/failed — used to
  // detect "this was the last active job" for toast aggregation below.
  const activeJobIdsRef = useRef<Set<string>>(new Set());
  // Counts successful completions since the last time the active set emptied
  // out. Reset to 0 once the aggregated toast fires. This is what makes bulk
  // imports (N jobs started together) produce exactly one toast instead of N.
  const completedBatchCountRef = useRef(0);

  // Fires the aggregated success toast once the active set is empty and at
  // least one job in the batch succeeded. Called from both onCompleted (the
  // common case) and onFailed (the leak this fixes — a failure can also be
  // the job that empties the active set, e.g. bulk A+B where A completes
  // silently and B fails; without this, completedBatchCountRef would stay
  // stranded at a nonzero value and get wrongly attributed to some later,
  // unrelated single import).
  const flushBatchToastIfEmpty = useCallback(() => {
    if (activeJobIdsRef.current.size > 0 || completedBatchCountRef.current === 0) return;
    const batchCount = completedBatchCountRef.current;
    completedBatchCountRef.current = 0;
    toast.success(batchCount > 1 ? 'Imports complete' : 'Import complete', {
      description: 'View your new files in the Library.',
      action: { label: 'View Library', onClick: () => navigate('/library') },
    });
  }, [navigate]);

  const registerJob = useCallback(
    (jobId: string, obsId?: string, label?: string) => {
      if (!jobId || subscriptionsRef.current.has(jobId)) return;

      activeJobIdsRef.current.add(jobId);

      setJobs((prev) => {
        const next = new Map(prev);
        next.set(jobId, { jobId, obsId, label, percent: 0, status: 'starting' });
        return next;
      });

      const { unsubscribe } = subscribeToJobProgress(jobId, {
        onProgress: (status: ImportJobStatus) => {
          setJobs((prev) => {
            const next = new Map(prev);
            next.set(jobId, { jobId, obsId, label, percent: status.progress, status: 'running' });
            return next;
          });
        },
        onCompleted: () => {
          setJobs((prev) => {
            const next = new Map(prev);
            next.set(jobId, { jobId, obsId, label, percent: 100, status: 'complete' });
            return next;
          });

          // Toast aggregation: only the job that empties the active set
          // fires a toast, and it summarizes every completion since the set
          // was last empty. This is the single toast source for import
          // completion — MastSearch and ArchivePage/WhatsNewPanel no longer
          // show their own completion toasts (they still show their own
          // error toasts/modals).
          activeJobIdsRef.current.delete(jobId);
          completedBatchCountRef.current += 1;
          flushBatchToastIfEmpty();

          // Drop the job after a brief success flash instead of immediately —
          // gives the pill a moment to show its success state.
          const timer = setTimeout(() => {
            setJobs((prev) => {
              const next = new Map(prev);
              next.delete(jobId);
              return next;
            });
            flashTimersRef.current.delete(jobId);
          }, COMPLETION_DISPLAY_MS);
          flashTimersRef.current.set(jobId, timer);
          subscriptionsRef.current.delete(jobId);
        },
        onFailed: (status: ImportJobStatus) => {
          toast.error(status.error ?? status.message ?? 'Import failed');
          activeJobIdsRef.current.delete(jobId);
          setJobs((prev) => {
            const next = new Map(prev);
            next.delete(jobId);
            return next;
          });
          subscriptionsRef.current.delete(jobId);

          // A failure can also be the job that empties the active set —
          // flush any already-completed jobs in this batch now instead of
          // leaking the count forward to a later, unrelated import.
          flushBatchToastIfEmpty();
        },
      });

      subscriptionsRef.current.set(jobId, unsubscribe);
    },
    [flushBatchToastIfEmpty]
  );

  // Seed from resumable/in-flight jobs on mount and whenever auth state
  // changes (login mid-session picks up any jobs). Anonymous users: no
  // network call, nothing to track — the effect body just returns.
  //
  // Teardown (unsubscribe + clear jobs) lives in the *cleanup* function
  // rather than an early-return branch in the setup body. That runs when
  // `isAuthenticated` flips to false (logout) or the component unmounts, and
  // keeps this effect from synchronously calling setState during its own
  // setup phase (see react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    mastService
      .getResumableImports()
      .then((res) => {
        if (cancelled) return;
        const jobsToTrack = (res.jobs ?? []).filter(
          (job) => !TERMINAL_RESUMABLE_STATUSES.has(job.status?.toLowerCase())
        );
        jobsToTrack.forEach((job) => registerJob(job.jobId, job.obsId));
      })
      .catch(() => {
        // Swallow — pill simply shows nothing until a job is registered locally.
      });

    return () => {
      cancelled = true;
      subscriptionsRef.current.forEach((unsub) => unsub());
      subscriptionsRef.current.clear();
      flashTimersRef.current.forEach((timer) => clearTimeout(timer));
      flashTimersRef.current.clear();
      activeJobIdsRef.current.clear();
      completedBatchCountRef.current = 0;
      setJobs(new Map());
    };
    // registerJob is stable (depends only on flushBatchToastIfEmpty, which in
    // turn depends only on the stable `navigate` reference);
    // re-running this effect should be driven solely by auth transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- see comment above
  }, [isAuthenticated]);

  const jobList = useMemo(() => Array.from(jobs.values()), [jobs]);

  const aggregatePercent = useMemo(() => {
    if (jobList.length === 0) return 0;
    const sum = jobList.reduce((acc, job) => acc + job.percent, 0);
    return Math.round(sum / jobList.length);
  }, [jobList]);

  return {
    jobs: jobList,
    aggregatePercent,
    activeCount: jobList.length,
    registerJob,
  };
}
