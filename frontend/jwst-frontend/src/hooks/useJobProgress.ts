/**
 * Two-layer job progress subscription: imperative API + React hook.
 *
 * Layer 1: `subscribeToJobProgress()` — imperative function for use in loops,
 *          async callbacks, and anywhere React hooks can't be used (e.g. bulk import).
 *
 * Layer 2: `useJobProgress()` — React hook wrapping the imperative function.
 *          For components with a single active job.
 *
 * Both layers try SignalR first, fall back to 500ms HTTP polling.
 */

import { useEffect, useState } from 'react';
import type { ImportJobStatus } from '../types/MastTypes';
import type {
  JobProgressUpdate,
  JobCompletionUpdate,
  JobFailureUpdate,
  JobSnapshotUpdate,
} from '../types/JobTypes';
import { subscribeToJob } from '../services/signalRService';
import { getImportProgress } from '../services/mastService';

/** Callbacks for the imperative subscription API. */
export interface JobProgressCallbacks {
  onProgress?: (status: ImportJobStatus) => void;
  onCompleted?: (status: ImportJobStatus) => void;
  onFailed?: (status: ImportJobStatus) => void;
}

/** Options for the imperative subscription. */
export interface SubscribeOptions {
  /** The observation ID (component already knows it, not in SignalR events). */
  obsId?: string;
  /** Polling interval in ms when falling back to HTTP. Default: 500. */
  pollIntervalMs?: number;
}

/** Return value from subscribeToJobProgress. */
export interface JobProgressSubscription {
  unsubscribe: () => void;
}

/**
 * Map snake_case file progress from SignalR metadata to camelCase FileProgressInfo.
 * Backend FileDownloadProgress uses [JsonPropertyName] with snake_case for processing engine
 * deserialization, but those same attributes apply when serialized through SignalR.
 */
function mapFileProgress(raw: unknown): ImportJobStatus['fileProgress'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item: Record<string, unknown>) => ({
    filename: (item.filename ?? item.fileName ?? '') as string,
    totalBytes: (item.total_bytes ?? item.totalBytes ?? 0) as number,
    downloadedBytes: (item.downloaded_bytes ?? item.downloadedBytes ?? 0) as number,
    progressPercent: (item.progress_percent ?? item.progressPercent ?? 0) as number,
    status: (item.status ?? 'pending') as string,
  }));
}

/**
 * Map a SignalR JobProgressUpdate to the ImportJobStatus shape that UI components expect.
 */
function mapProgressToImportStatus(
  update: JobProgressUpdate,
  obsId?: string,
  prev?: ImportJobStatus
): ImportJobStatus {
  return {
    jobId: update.jobId,
    obsId: obsId ?? prev?.obsId ?? '',
    progress: update.progressPercent,
    stage: update.stage ?? prev?.stage ?? '',
    message: update.message ?? prev?.message ?? '',
    isComplete: false,
    startedAt: prev?.startedAt ?? new Date().toISOString(),
    downloadedBytes: (update.metadata?.DownloadedBytes as number) ?? prev?.downloadedBytes,
    totalBytes: (update.metadata?.TotalBytes as number) ?? prev?.totalBytes,
    speedBytesPerSec: (update.metadata?.SpeedBytesPerSec as number) ?? prev?.speedBytesPerSec,
    etaSeconds: (update.metadata?.EtaSeconds as number) ?? prev?.etaSeconds,
    fileProgress: mapFileProgress(update.metadata?.FileProgress) ?? prev?.fileProgress,
    downloadProgressPercent: prev?.downloadProgressPercent,
    isResumable: prev?.isResumable,
    downloadJobId: prev?.downloadJobId,
    result: prev?.result,
  };
}

/**
 * Map a SignalR JobSnapshotUpdate to ImportJobStatus.
 */
function mapSnapshotToImportStatus(snapshot: JobSnapshotUpdate, obsId?: string): ImportJobStatus {
  const isComplete = !['queued', 'running'].includes(snapshot.state);
  return {
    jobId: snapshot.jobId,
    obsId: obsId ?? '',
    progress: snapshot.progressPercent,
    stage: snapshot.stage ?? '',
    message: snapshot.message ?? '',
    isComplete,
    error: snapshot.error,
    startedAt: snapshot.startedAt ?? snapshot.createdAt,
    completedAt: snapshot.completedAt,
    downloadedBytes: snapshot.metadata?.DownloadedBytes as number | undefined,
    totalBytes: snapshot.metadata?.TotalBytes as number | undefined,
    speedBytesPerSec: snapshot.metadata?.SpeedBytesPerSec as number | undefined,
    etaSeconds: snapshot.metadata?.EtaSeconds as number | undefined,
    fileProgress: mapFileProgress(snapshot.metadata?.FileProgress),
  };
}

/**
 * Layer 1: Imperative subscription API.
 *
 * Tries SignalR first. If SignalR connection fails, falls back to HTTP polling.
 * Can be called in loops, async callbacks, Promise.allSettled — anywhere.
 *
 * @returns A subscription with an `unsubscribe()` method.
 */
export function subscribeToJobProgress(
  jobId: string,
  callbacks: JobProgressCallbacks,
  options?: SubscribeOptions
): JobProgressSubscription {
  let cancelled = false;
  let signalRUnsub: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStatus: ImportJobStatus | undefined;

  const pollInterval = options?.pollIntervalMs ?? 500;

  // Try SignalR first
  subscribeToJob(jobId, {
    onProgress: (update: JobProgressUpdate) => {
      if (cancelled) return;
      currentStatus = mapProgressToImportStatus(update, options?.obsId, currentStatus);
      callbacks.onProgress?.(currentStatus);
    },
    onCompleted: (update: JobCompletionUpdate) => {
      if (cancelled) return;
      // Fetch final status from old endpoint to get result (importedCount)
      // because JobCompletionUpdate doesn't carry metadata
      getImportProgress(jobId)
        .then((finalStatus) => {
          if (cancelled) return;
          callbacks.onCompleted?.(finalStatus);
        })
        .catch(() => {
          if (cancelled) return;
          // Fallback: construct a minimal completed status
          const completedStatus: ImportJobStatus = {
            jobId: update.jobId,
            obsId: options?.obsId ?? currentStatus?.obsId ?? '',
            progress: 100,
            stage: 'Complete',
            message: update.message ?? 'Import completed',
            isComplete: true,
            startedAt: currentStatus?.startedAt ?? new Date().toISOString(),
            completedAt: update.completedAt,
          };
          callbacks.onCompleted?.(completedStatus);
        });
    },
    onFailed: (update: JobFailureUpdate) => {
      if (cancelled) return;
      const failedStatus: ImportJobStatus = {
        jobId: update.jobId,
        obsId: options?.obsId ?? currentStatus?.obsId ?? '',
        progress: currentStatus?.progress ?? 0,
        stage: update.state === 'cancelled' ? 'Cancelled' : 'Failed',
        message: update.error,
        isComplete: true,
        error: update.error,
        startedAt: currentStatus?.startedAt ?? new Date().toISOString(),
        completedAt: update.failedAt,
      };
      callbacks.onFailed?.(failedStatus);
    },
    onSnapshot: (snapshot: JobSnapshotUpdate) => {
      if (cancelled) return;
      currentStatus = mapSnapshotToImportStatus(snapshot, options?.obsId);
      if (currentStatus.isComplete) {
        if (currentStatus.error) {
          callbacks.onFailed?.(currentStatus);
        } else {
          callbacks.onCompleted?.(currentStatus);
        }
      } else {
        callbacks.onProgress?.(currentStatus);
      }
    },
  })
    .then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      signalRUnsub = unsub;
    })
    .catch(() => {
      // SignalR failed — start polling fallback
      if (cancelled) return;
      startPolling();
    });

  function startPolling(): void {
    const pollingStartTime = Date.now();
    const maxPollingDuration = 10 * 60 * 1000; // 10 minutes

    async function poll(): Promise<void> {
      if (cancelled) return;

      // Safety: stop polling after 10 minutes to prevent infinite hang
      if (Date.now() - pollingStartTime > maxPollingDuration) {
        const timeoutStatus: ImportJobStatus = {
          jobId,
          obsId: options?.obsId ?? currentStatus?.obsId ?? '',
          progress: currentStatus?.progress ?? 0,
          stage: 'Failed',
          message: 'Polling timed out after 10 minutes',
          isComplete: true,
          error: 'Polling timed out after 10 minutes',
          startedAt: currentStatus?.startedAt ?? new Date().toISOString(),
        };
        callbacks.onFailed?.(timeoutStatus);
        return;
      }

      try {
        const status = await getImportProgress(jobId);
        if (cancelled) return;
        currentStatus = status;

        if (status.isComplete) {
          if (status.error || status.stage === 'Failed' || status.stage === 'Cancelled') {
            callbacks.onFailed?.(status);
          } else {
            callbacks.onCompleted?.(status);
          }
          return; // Stop polling
        }

        callbacks.onProgress?.(status);
        pollTimer = setTimeout(poll, pollInterval);
      } catch {
        if (cancelled) return;
        // Retry on error
        pollTimer = setTimeout(poll, pollInterval);
      }
    }
    poll();
  }

  return {
    unsubscribe: () => {
      cancelled = true;
      signalRUnsub?.();
      if (pollTimer) clearTimeout(pollTimer);
    },
  };
}

/**
 * Layer 2: React hook wrapping the imperative subscription.
 *
 * For components with a single active job. Pass `null` to disable.
 *
 * @param jobId - The job ID to track, or null to not track anything.
 * @param obsId - Optional observation ID for the status mapping.
 * @returns Current progress state.
 */
export function useJobProgress(
  jobId: string | null,
  obsId?: string
): {
  progress: ImportJobStatus | null;
  isComplete: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    progress: ImportJobStatus | null;
    isComplete: boolean;
    error: string | null;
  }>({ progress: null, isComplete: false, error: null });

  // Reset state during render when jobId changes to null (no effect needed)
  const [prevJobId, setPrevJobId] = useState<string | null>(null);
  if (jobId !== prevJobId) {
    setPrevJobId(jobId);
    if (!jobId) {
      setState({ progress: null, isComplete: false, error: null });
    }
  }

  useEffect(() => {
    if (!jobId) return;

    const sub = subscribeToJobProgress(
      jobId,
      {
        onProgress: (status) => {
          setState({ progress: status, isComplete: false, error: null });
        },
        onCompleted: (status) => {
          setState({ progress: status, isComplete: true, error: null });
        },
        onFailed: (status) => {
          setState({ progress: status, isComplete: true, error: status.error ?? status.message });
        },
      },
      { obsId }
    );

    return () => sub.unsubscribe();
  }, [jobId, obsId]);

  const { progress, isComplete, error } = state;

  return { progress, isComplete, error };
}
