import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../../ui/toast';
import {
  ImportJobStatus,
  ImportStages,
  BulkImportStatus,
  ResumableJobSummary,
} from '../../../types/MastTypes';
import { mastService, ApiError, type DownloadSource } from '../../../services';
import { useJobProgress, subscribeToJobProgress } from '../../../hooks/useJobProgress';
import { useActiveImportsContext } from '../../../context/useActiveImportsContext';

// Maximum number of concurrent observation imports
export const MAX_CONCURRENT_IMPORTS = 3;

export interface UseBulkImportOptions {
  isAuthenticated: boolean;
  /**
   * Calibration levels to import — derived by the page from the last search
   * (observation-ID searches import every level → undefined).
   */
  calibLevel: number[] | undefined;
}

export interface UseBulkImportResult {
  downloadSource: DownloadSource;
  setDownloadSource: (source: DownloadSource) => void;
  /** obs_id currently being imported via the single-import flow, if any. */
  importing: string | null;
  importProgress: ImportJobStatus | null;
  cancelling: boolean;
  bulkImportStatus: BulkImportStatus | null;
  resumableJobs: ResumableJobSummary[];
  expandedFileGroups: Set<string>;
  toggleFileGroup: (groupKey: string) => void;
  handleImport: (obsId: string) => Promise<void>;
  /** Import every id; one id takes the single-import path. Resolves when all settle. */
  handleBulkImport: (obsIds: string[]) => Promise<void>;
  handleResumeImport: (jobId: string, obsId: string) => Promise<void>;
  handleCancelImport: () => Promise<void>;
  closeProgressModal: () => void;
  closeBulk: () => void;
  handleResumeFromPanel: (job: ResumableJobSummary) => void;
  handleDismissDownload: (job: ResumableJobSummary) => void;
}

/**
 * MAST import wiring: single import, bulk import (a queue of at most
 * MAX_CONCURRENT_IMPORTS jobs), resume, import-from-existing, cancel, and the
 * resumable-downloads list. Every call goes through `mastService` to the .NET
 * endpoints unchanged — import migration is ADR 0001's, not this hook's.
 *
 * Extracted from MastSearch.tsx (MAST Search v2 Phase 3).
 */
export function useBulkImport({
  isAuthenticated,
  calibLevel,
}: UseBulkImportOptions): UseBulkImportResult {
  // `registerJob` hands each started job to the shared useActiveImports
  // instance (header pill). That hook subscribes independently of this
  // hook's own useJobProgress/ImportProgress modal — deliberate redundancy
  // so the pill/toast survive navigation away from /search. See the
  // doc-comment on useActiveImports for the full rationale, including why
  // /search fetches GET /api/mast/import/resumable twice.
  const { registerJob } = useActiveImportsContext();

  const [downloadSource, setDownloadSource] = useState<DownloadSource>('auto');
  const [importing, setImporting] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeObsId, setActiveObsId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bulkImportStatus, setBulkImportStatus] = useState<BulkImportStatus | null>(null);
  const [resumableJobs, setResumableJobs] = useState<ResumableJobSummary[]>([]);
  const [expandedFileGroups, setExpandedFileGroups] = useState<Set<string>>(() => new Set());

  // SignalR-backed job progress for single import / resume / import-from-existing
  const { progress: jobProgress, isComplete: jobIsComplete } = useJobProgress(
    activeJobId,
    activeObsId ?? undefined
  );

  // #1578: the last job whose completion this hook has handled.
  const handledCompletionRef = useRef<string | null>(null);

  const refreshResumableJobs = useCallback(() => {
    mastService
      .getResumableImports()
      .then((res) => setResumableJobs(Array.isArray(res.jobs) ? res.jobs : []))
      .catch(() => {}); // Silently fail - section just won't show
  }, []);

  // Fetch resumable (incomplete) downloads on mount — authenticated only.
  // GET /api/mast/import/resumable requires auth; calling it for anonymous
  // visitors to /search would 401 on every page load for no benefit (they
  // can't have any resumable jobs of their own).
  useEffect(() => {
    if (isAuthenticated) refreshResumableJobs();
  }, [isAuthenticated, refreshResumableJobs]);

  // Sync hook progress to importProgress state (runs on every tick)
  useEffect(() => {
    if (jobProgress) {
      setImportProgress(jobProgress);
    }
  }, [jobProgress]);

  // Handle completion. No success toast here — `useActiveImports` (the global
  // header pill's hook) is the single source of import-completion toasts, with
  // last-job-in-batch aggregation so bulk imports don't spam one toast per job.
  // See useActiveImports.ts.
  //
  // #1578: gated on the JOB, not on the isComplete boolean. useJobProgress
  // resets isComplete during render when jobId changes, so on a fast
  // A-completes -> B-starts -> B-completes sequence a [jobIsComplete]-only
  // effect can fire against stale progress or not fire at all. The ref makes it
  // exactly-once per job and lets the real dependencies be declared, which is
  // what removes the suppression (#1417/#1311).
  useEffect(() => {
    if (!jobIsComplete || !jobProgress) return;
    if (handledCompletionRef.current === jobProgress.jobId) return;
    handledCompletionRef.current = jobProgress.jobId;
    setImporting(null);
  }, [jobIsComplete, jobProgress]);

  const failProgress = (err: unknown, extra: Partial<ImportJobStatus> = {}) =>
    setImportProgress((prev) =>
      prev
        ? {
            ...prev,
            stage: ImportStages.Failed,
            message: err instanceof Error ? err.message : 'Unknown error',
            isComplete: true,
            error: err instanceof Error ? err.message : 'Unknown error',
            ...extra,
          }
        : null
    );

  const handleImport = async (obsIdToImport: string) => {
    setImporting(obsIdToImport);
    setActiveObsId(obsIdToImport);
    setImportProgress({
      jobId: '',
      obsId: obsIdToImport,
      progress: 0,
      stage: ImportStages.Starting,
      message: 'Starting import...',
      isComplete: false,
      startedAt: new Date().toISOString(),
    });

    try {
      // Start the import job
      const startData = await mastService.startImport({
        obsId: obsIdToImport,
        productType: 'SCIENCE',
        tags: ['mast-import'],
        calibLevel,
        downloadSource,
      });
      // Setting activeJobId triggers useJobProgress hook → SignalR/polling
      setActiveJobId(startData.jobId);
      // Also register with the shared pub/sub so the header pill picks it up
      // even if the user navigates away before this hook's own
      // useJobProgress subscription would otherwise track it.
      registerJob(startData.jobId, obsIdToImport);
    } catch (err) {
      failProgress(err);
      setImporting(null);
    }
  };

  const closeProgressModal = () => {
    setActiveJobId(null);
    setActiveObsId(null);
    setImportProgress(null);
    setCancelling(false);
    refreshResumableJobs(); // Refresh incomplete downloads panel after cancel/error/close
  };

  const handleCancelImport = async () => {
    if (!importProgress?.jobId) return;

    setCancelling(true);
    try {
      await mastService.cancelImport(importProgress.jobId);
      // The polling loop will detect the cancellation and update the UI
    } catch (err) {
      console.error('Cancel error:', err);
    }
    // Don't set cancelling to false here - let the polling loop handle the UI update
  };

  // Import from files that already exist on disk
  const handleImportFromExisting = async (obsIdToImport: string) => {
    setActiveObsId(obsIdToImport);
    setImportProgress({
      jobId: '',
      obsId: obsIdToImport,
      progress: 30,
      stage: ImportStages.SavingRecords,
      message: 'Checking for downloaded files...',
      isComplete: false,
      startedAt: new Date().toISOString(),
    });

    try {
      // Start import from existing files
      const startData = await mastService.importFromExisting(obsIdToImport);

      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              jobId: startData.jobId,
              message: startData.message,
              progress: 45,
            }
          : null
      );

      // Setting activeJobId triggers useJobProgress hook → SignalR/polling
      setActiveJobId(startData.jobId);
      registerJob(startData.jobId, obsIdToImport);
    } catch (err) {
      // Handle 404 (no files found)
      if (ApiError.isApiError(err) && err.status === 404) {
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                stage: ImportStages.Failed,
                message: 'No downloaded files found. Please start a new import.',
                isComplete: true,
                error: 'No files found',
                isResumable: false,
              }
            : null
        );
        return;
      }
      failProgress(err);
    } finally {
      setImporting(null);
    }
  };

  const handleResumeImport = async (jobId: string, obsIdToResume: string) => {
    setImporting(obsIdToResume);
    setActiveObsId(obsIdToResume);
    setImportProgress({
      jobId,
      obsId: obsIdToResume,
      progress: 0,
      stage: ImportStages.Downloading,
      message: 'Resuming download...',
      isComplete: false,
      startedAt: new Date().toISOString(),
    });

    try {
      // Call resume endpoint
      const resumeData = await mastService.resumeImport(jobId);

      // The backend may return a new import tracker job ID
      const trackingJobId = (resumeData as unknown as { jobId?: string }).jobId || jobId;

      // Check if resume found existing files
      if ((resumeData as unknown as { filesFound?: number }).filesFound) {
        const filesFound = (resumeData as unknown as { filesFound: number }).filesFound;
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                jobId: trackingJobId,
                stage: ImportStages.SavingRecords,
                message: `Found ${filesFound} downloaded files, creating records...`,
                progress: 45,
              }
            : null
        );
      }

      // Setting activeJobId triggers useJobProgress hook → SignalR/polling
      setActiveJobId(trackingJobId);
      registerJob(trackingJobId, obsIdToResume);
    } catch (err) {
      // Handle "job not found" error by checking for existing files
      if (ApiError.isApiError(err) && err.status === 404) {
        console.warn('Job not found, checking for existing files...');
        await handleImportFromExisting(obsIdToResume);
        return;
      }

      // Handle "cannot resume - no files" error
      // #1687: read the backend's `suggestion` field rather than substring-matching
      // the whole stringified body — the phrase lives in `suggestion`, which
      // extractMessage never promotes to `message`.
      if (
        ApiError.isApiError(err) &&
        err.field('suggestion')?.includes('Please start a new import')
      ) {
        const errorMessage = err.message || 'Cannot resume';
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                stage: ImportStages.Failed,
                message: errorMessage,
                isComplete: true,
                error: errorMessage,
                isResumable: false,
              }
            : null
        );
        setImporting(null);
        return;
      }

      failProgress(err, { isResumable: true });
      setImporting(null);
    }
  };

  const handleResumeFromPanel = (job: ResumableJobSummary) => {
    // Remove from the resumable list immediately
    setResumableJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
    // Delegate to existing resume handler
    void handleResumeImport(job.jobId, job.obsId);
  };

  const doDismissDownload = async (jobId: string, deleteFiles: boolean) => {
    try {
      await mastService.dismissResumableImport(jobId, deleteFiles);
      setResumableJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } catch (err) {
      console.error('Failed to dismiss download:', err);
      toast.error('Failed to dismiss download');
    }
  };

  const handleDismissDownload = (job: ResumableJobSummary) => {
    if (job.completedFiles > 0) {
      toast(`This download has ${job.completedFiles} completed file(s). Delete them too?`, {
        action: {
          label: 'Delete files',
          onClick: () => doDismissDownload(job.jobId, true),
        },
        cancel: {
          label: 'Keep files',
          onClick: () => doDismissDownload(job.jobId, false),
        },
        duration: 15_000,
      });
    } else {
      void doDismissDownload(job.jobId, false);
    }
  };

  // Process a single observation for bulk import (uses imperative API, not hooks)
  const processBulkImportSingle = async (obsIdToImport: string): Promise<void> => {
    // Move from pending to active jobs
    setBulkImportStatus((prev) => {
      if (!prev) return prev;
      const newPending = prev.pendingObsIds.filter((id) => id !== obsIdToImport);
      const newJobs = new Map(prev.jobs);
      newJobs.set(obsIdToImport, {
        jobId: '',
        obsId: obsIdToImport,
        progress: 0,
        stage: ImportStages.Starting,
        message: 'Initializing...',
        isComplete: false,
        startedAt: new Date().toISOString(),
      });
      return { ...prev, pendingObsIds: newPending, jobs: newJobs };
    });

    try {
      // Start the import job
      const startData = await mastService.startImport({
        obsId: obsIdToImport,
        productType: 'SCIENCE',
        tags: ['mast-import'],
        calibLevel,
        downloadSource,
      });
      const jobId = startData.jobId;

      // Update with job ID
      setBulkImportStatus((prev) => {
        if (!prev) return prev;
        const newJobs = new Map(prev.jobs);
        const existingJob = newJobs.get(obsIdToImport);
        if (existingJob) {
          newJobs.set(obsIdToImport, { ...existingJob, jobId });
        }
        return { ...prev, jobs: newJobs };
      });

      // Also register with the shared pub/sub so the header pill tracks
      // this job independently of this hook's bulk-import state.
      registerJob(jobId, obsIdToImport);

      // Use imperative subscription (can't use hooks in async loop)
      await new Promise<void>((resolve) => {
        const { unsubscribe } = subscribeToJobProgress(
          jobId,
          {
            onProgress: (status) => {
              setBulkImportStatus((prev) => {
                if (!prev) return prev;
                const newJobs = new Map(prev.jobs);
                newJobs.set(obsIdToImport, status);
                return { ...prev, jobs: newJobs };
              });
            },
            onCompleted: (status) => {
              setBulkImportStatus((prev) => {
                if (!prev) return prev;
                const newJobs = new Map(prev.jobs);
                newJobs.set(obsIdToImport, status);
                return { ...prev, completedCount: prev.completedCount + 1, jobs: newJobs };
              });
              unsubscribe();
              resolve();
            },
            onFailed: (status) => {
              setBulkImportStatus((prev) => {
                if (!prev) return prev;
                const newJobs = new Map(prev.jobs);
                newJobs.set(obsIdToImport, status);
                return { ...prev, failedCount: prev.failedCount + 1, jobs: newJobs };
              });
              unsubscribe();
              resolve();
            },
          },
          { obsId: obsIdToImport }
        );
      });
    } catch (err) {
      // Mark as failed
      setBulkImportStatus((prev) => {
        if (!prev) return prev;
        const newJobs = new Map(prev.jobs);
        const existingJob = newJobs.get(obsIdToImport);
        if (existingJob) {
          newJobs.set(obsIdToImport, {
            ...existingJob,
            stage: ImportStages.Failed,
            message: err instanceof Error ? err.message : 'Import failed',
            isComplete: true,
            error: err instanceof Error ? err.message : 'Import failed',
          });
        }
        return { ...prev, failedCount: prev.failedCount + 1, jobs: newJobs };
      });
    }
  };

  const handleBulkImport = async (obsIds: string[]) => {
    if (obsIds.length === 0) return;
    // #1648: the button is hidden for anonymous users, but a selection made
    // before a session expired would otherwise fire N imports that all 401.
    if (!isAuthenticated) return;

    // For single observation, use the existing single-import flow
    if (obsIds.length === 1) {
      await handleImport(obsIds[0]);
      return;
    }

    // Initialize bulk import status
    setBulkImportStatus({
      jobs: new Map(),
      pendingObsIds: [...obsIds],
      totalCount: obsIds.length,
      completedCount: 0,
      failedCount: 0,
      isActive: true,
    });

    // Process with concurrency limit using a semaphore pattern
    let activeCount = 0;
    let currentIndex = 0;
    const results: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (currentIndex < obsIds.length) {
        // Wait if we've hit the concurrency limit
        if (activeCount >= MAX_CONCURRENT_IMPORTS) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        const obsId = obsIds[currentIndex];
        currentIndex++;
        activeCount++;

        const promise = processBulkImportSingle(obsId).finally(() => {
          activeCount--;
        });
        results.push(promise);
      }
    };

    // Start the processing loop
    await processNext();

    // Wait for all to complete
    await Promise.allSettled(results);

    // Mark bulk import complete
    setBulkImportStatus((prev) => (prev ? { ...prev, isActive: false } : null));
  };

  const toggleFileGroup = (groupKey: string) => {
    setExpandedFileGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return {
    downloadSource,
    setDownloadSource,
    importing,
    importProgress,
    cancelling,
    bulkImportStatus,
    resumableJobs,
    expandedFileGroups,
    toggleFileGroup,
    handleImport,
    handleBulkImport,
    handleResumeImport,
    handleCancelImport,
    closeProgressModal,
    closeBulk: () => setBulkImportStatus(null),
    handleResumeFromPanel,
    handleDismissDownload,
  };
}
