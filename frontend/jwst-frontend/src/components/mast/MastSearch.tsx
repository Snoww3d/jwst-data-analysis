import React, { useState, useEffect } from 'react';
import { toast } from '../ui/toast';
import {
  MastSearchType,
  MastObservationResult,
  ImportJobStatus,
  ImportStages,
  BulkImportStatus,
  ResumableJobSummary,
} from '../../types/MastTypes';
import type { DataAvailabilityItem } from '../../types/JwstDataTypes';
import { mastService, jwstDataService, ApiError, type DownloadSource } from '../../services';
import { useJobProgress, subscribeToJobProgress } from '../../hooks/useJobProgress';
import { useAuth } from '../../context/useAuth';
import { useActiveImportsContext } from '../../context/useActiveImportsContext';
import SearchForm from './SearchForm';
import ResultsTable from './ResultsTable';
import ImportProgress from './ImportProgress';
import './MastSearch.css';

// Maximum number of concurrent observation imports
const MAX_CONCURRENT_IMPORTS = 3;

const SEARCH_TIMEOUT_MS = 120000; // 2 minutes

/**
 * MAST Portal search orchestrator: search-mode state, result set, import
 * job wiring (single/bulk/resume), and resumable-download panel.
 *
 * Decomposed from the former monolithic MastSearch.tsx (#1617) into this
 * orchestrator + SearchForm / ResultsTable / ImportProgress. Behavior is
 * preserved verbatim except:
 *  - `importedObsIds`/`onImportComplete` props are gone. After each search,
 *    results are checked against the library via `checkDataAvailability`
 *    (anonymous-safe); failures are swallowed silently (no badges).
 *  - Anonymous users see "Log in to import" instead of the Import button.
 */
const MastSearch: React.FC = () => {
  const { isAuthenticated } = useAuth();
  // `registerJob` hands each started job to the shared useActiveImports
  // instance (header pill). That hook subscribes independently of this
  // component's own useJobProgress/ImportProgress modal — deliberate
  // redundancy so the pill/toast survive navigation away from /archive.
  // See the doc-comment on useActiveImports for the full rationale,
  // including why /archive fetches GET /api/mast/import/resumable twice.
  const { registerJob } = useActiveImportsContext();

  const [searchType, setSearchType] = useState<MastSearchType>('target');
  const [targetName, setTargetName] = useState('');
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [radius, setRadius] = useState('0.2');
  const [obsId, setObsId] = useState('');
  const [programId, setProgramId] = useState('');
  const [showAllCalibLevels, setShowAllCalibLevels] = useState(false);
  const [downloadSource, setDownloadSource] = useState<DownloadSource>('auto');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MastObservationResult[]>([]);
  const [availability, setAvailability] = useState<Record<string, DataAvailabilityItem>>({});
  const [selectedObs, setSelectedObs] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeObsId, setActiveObsId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bulkImportStatus, setBulkImportStatus] = useState<BulkImportStatus | null>(null);
  const [resumableJobs, setResumableJobs] = useState<ResumableJobSummary[]>([]);
  const [resumableCollapsed, setResumableCollapsed] = useState(true);
  const [expandedFileGroups, setExpandedFileGroups] = useState<Set<string>>(() => new Set());

  // SignalR-backed job progress for single import / resume / import-from-existing
  const { progress: jobProgress, isComplete: jobIsComplete } = useJobProgress(
    activeJobId,
    activeObsId ?? undefined
  );

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Calculate paginated results
  const totalPages = Math.ceil(searchResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedResults = searchResults.slice(startIndex, endIndex);

  const refreshResumableJobs = () => {
    mastService
      .getResumableImports()
      .then((res) => setResumableJobs(Array.isArray(res.jobs) ? res.jobs : []))
      .catch(() => {}); // Silently fail - section just won't show
  };

  // Fetch resumable (incomplete) downloads on mount — authenticated only.
  // GET /api/mast/import/resumable requires auth; calling it for anonymous
  // visitors to /archive would 401 on every page load for no benefit (they
  // can't have any resumable jobs of their own).
  useEffect(() => {
    if (isAuthenticated) refreshResumableJobs();
  }, [isAuthenticated]);

  // Check library availability for the current result set. Anonymous-safe;
  // failures are swallowed silently (no badges, no error UI).
  useEffect(() => {
    const obsIds = searchResults.map((r) => r.obs_id).filter((id): id is string => !!id);
    if (obsIds.length === 0) {
      setAvailability({});
      return;
    }

    const controller = new AbortController();
    jwstDataService
      .checkDataAvailability(obsIds, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setAvailability(res.results);
      })
      .catch(() => {
        /* availability check failed or aborted — results render without badges */
      });

    return () => controller.abort();
  }, [searchResults]);

  // Sync hook progress to importProgress state (runs on every tick)
  useEffect(() => {
    if (jobProgress) {
      setImportProgress(jobProgress);
    }
  }, [jobProgress]);

  // Handle completion (only fires when isComplete changes). No success toast
  // here — `useActiveImports` (the global header pill's hook) is the single
  // source of import-completion toasts, with last-job-in-batch aggregation
  // so bulk imports don't spam one toast per job. See useActiveImports.ts.
  useEffect(() => {
    if (jobIsComplete && jobProgress) {
      setImporting(null);
    }
  }, [jobIsComplete]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only fire on completion transition

  const handleResumeFromPanel = (job: ResumableJobSummary) => {
    // Remove from the resumable list immediately
    setResumableJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
    // Delegate to existing resume handler
    handleResumeImport(job.jobId, job.obsId);
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
      doDismissDownload(job.jobId, false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSearchResults([]);
    setSelectedObs(new Set());
    setCurrentPage(1); // Reset to first page on new search

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      let data;

      // Determine calibration levels: show all (1,2,3) or just Level 3 (combined/mosaic)
      // Observation ID searches always show all levels (calibLevel undefined)
      const calibLevel = showAllCalibLevels ? [1, 2, 3] : [3];

      switch (searchType) {
        case 'target':
          if (!targetName.trim()) {
            setError('Please enter a target name');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          data = await mastService.searchByTarget(
            { targetName: targetName.trim(), radius: parseFloat(radius), calibLevel },
            controller.signal
          );
          break;
        case 'coordinates':
          if (!ra.trim() || !dec.trim()) {
            setError('Please enter both RA and Dec coordinates');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          data = await mastService.searchByCoordinates(
            { ra: parseFloat(ra), dec: parseFloat(dec), radius: parseFloat(radius), calibLevel },
            controller.signal
          );
          break;
        case 'observation':
          if (!obsId.trim()) {
            setError('Please enter an observation ID');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          // Observation ID searches show all calibration levels by default
          data = await mastService.searchByObservation({ obsId: obsId.trim() }, controller.signal);
          break;
        case 'program':
          if (!programId.trim()) {
            setError('Please enter a program ID');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          data = await mastService.searchByProgram(
            { programId: programId.trim(), calibLevel },
            controller.signal
          );
          break;
      }

      clearTimeout(timeoutId);

      if (data) {
        setSearchResults(data.results);
        if (data.results.length === 0) {
          setError('No JWST observations found matching your search criteria');
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        setError(
          'Search timed out. MAST queries can take a while for large search areas. Try a smaller radius or more specific search terms.'
        );
      } else if (ApiError.isApiError(err)) {
        if (err.status === 503) {
          setError(
            'The processing engine is currently unavailable. Please wait a moment and try again — the service may still be starting up.'
          );
        } else if (err.status === 504) {
          setError('Search timed out. Try a smaller search radius or more specific search terms.');
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      setLoading(false);
    }
  };

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
      // Determine calibration levels to import
      const calibLevel =
        searchType === 'observation' ? undefined : showAllCalibLevels ? [1, 2, 3] : [3];

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
      // even if the user navigates away before this component's own
      // useJobProgress subscription would otherwise track it.
      registerJob(startData.jobId, obsIdToImport);
    } catch (err) {
      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              stage: ImportStages.Failed,
              message: err instanceof Error ? err.message : 'Unknown error',
              isComplete: true,
              error: err instanceof Error ? err.message : 'Unknown error',
            }
          : null
      );
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
      if (ApiError.isApiError(err) && err.details?.includes('Please start a new import')) {
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

      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              stage: ImportStages.Failed,
              message: err instanceof Error ? err.message : 'Unknown error',
              isComplete: true,
              error: err instanceof Error ? err.message : 'Unknown error',
              isResumable: true,
            }
          : null
      );
      setImporting(null);
    }
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

      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              stage: ImportStages.Failed,
              message: err instanceof Error ? err.message : 'Unknown error',
              isComplete: true,
              error: err instanceof Error ? err.message : 'Unknown error',
            }
          : null
      );
    } finally {
      setImporting(null);
    }
  };

  const toggleSelection = (obsIdToToggle: string) => {
    const newSelected = new Set(selectedObs);
    if (newSelected.has(obsIdToToggle)) {
      newSelected.delete(obsIdToToggle);
    } else {
      newSelected.add(obsIdToToggle);
    }
    setSelectedObs(newSelected);
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
      // Determine calibration levels to import
      const calibLevel =
        searchType === 'observation' ? undefined : showAllCalibLevels ? [1, 2, 3] : [3];

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
      // this job independently of this component's bulk-import state.
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

  const handleBulkImport = async () => {
    const obsIds = Array.from(selectedObs);
    if (obsIds.length === 0) return;

    // For single observation, use the existing single-import flow
    if (obsIds.length === 1) {
      await handleImport(obsIds[0]);
      setSelectedObs(new Set());
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
    setSelectedObs(new Set());
  };

  const toggleFileGroup = (groupKey: string) => {
    setExpandedFileGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="mast-search">
      <h2>MAST Portal Search</h2>
      <p className="mast-description">
        Search the Mikulski Archive for Space Telescopes (MAST) for JWST observations
      </p>

      <SearchForm
        searchType={searchType}
        onSearchTypeChange={setSearchType}
        targetName={targetName}
        onTargetNameChange={setTargetName}
        ra={ra}
        onRaChange={setRa}
        dec={dec}
        onDecChange={setDec}
        radius={radius}
        onRadiusChange={setRadius}
        obsId={obsId}
        onObsIdChange={setObsId}
        programId={programId}
        onProgramIdChange={setProgramId}
        showAllCalibLevels={showAllCalibLevels}
        onShowAllCalibLevelsChange={setShowAllCalibLevels}
        downloadSource={downloadSource}
        onDownloadSourceChange={setDownloadSource}
        loading={loading}
        onSearch={handleSearch}
      />

      {error && <div className="error-message">{error}</div>}

      {/* Resumable (Incomplete) Downloads Section — authenticated only */}
      {isAuthenticated && resumableJobs.length > 0 && (
        <div className="resumable-section">
          <div
            className="resumable-header"
            onClick={() => setResumableCollapsed(!resumableCollapsed)}
            style={{ cursor: 'pointer' }}
          >
            <h3>
              <span className={`resumable-chevron ${resumableCollapsed ? '' : 'open'}`}>{'▶'}</span>{' '}
              Incomplete Downloads ({resumableJobs.length})
            </h3>
          </div>
          {!resumableCollapsed &&
            [...resumableJobs]
              .sort(
                (a, b) =>
                  new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
              )
              .map((job) => {
                const obsIdParts = job.obsId.split('_');
                const shortId =
                  obsIdParts.length > 2 ? obsIdParts.slice(-2).join('_') : job.obsId.slice(-20);
                return (
                  <div key={job.jobId} className="resumable-row">
                    <span className="resumable-obs-id" title={job.obsId}>
                      {shortId}
                    </span>
                    <div className="resumable-progress-bar">
                      <div
                        className="resumable-progress-fill"
                        style={{ width: `${job.progressPercent}%` }}
                      />
                    </div>
                    <span className="resumable-percent">{job.progressPercent.toFixed(0)}%</span>
                    <span className="resumable-files">
                      {job.completedFiles}/{job.totalFiles} files
                    </span>
                    <button
                      className="btn-base btn-standard resumable-resume-btn"
                      onClick={() => handleResumeFromPanel(job)}
                      disabled={importing !== null}
                    >
                      Resume
                    </button>
                    <button
                      className="btn-base resumable-dismiss-btn"
                      onClick={() => handleDismissDownload(job)}
                      title="Dismiss this download"
                    >
                      {'✕'}
                    </button>
                  </div>
                );
              })}
        </div>
      )}

      {searchResults.length > 0 && (
        <ResultsTable
          searchResults={searchResults}
          paginatedResults={paginatedResults}
          startIndex={startIndex}
          endIndex={endIndex}
          selectedObs={selectedObs}
          onToggleSelection={toggleSelection}
          onBulkImport={handleBulkImport}
          importing={importing}
          onImport={handleImport}
          isAuthenticated={isAuthenticated}
          availability={availability}
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={(size) => {
            setItemsPerPage(size);
            setCurrentPage(1);
          }}
        />
      )}

      <ImportProgress
        importProgress={importProgress}
        downloadSource={downloadSource}
        cancelling={cancelling}
        expandedFileGroups={expandedFileGroups}
        onToggleFileGroup={toggleFileGroup}
        onCancel={handleCancelImport}
        onClose={closeProgressModal}
        onResume={handleResumeImport}
        onRetry={handleImport}
        bulkImportStatus={bulkImportStatus}
        onCloseBulk={() => setBulkImportStatus(null)}
      />
    </div>
  );
};

export default MastSearch;
