import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  MastSearchType,
  MastObservationResult,
  ImportJobStatus,
  ImportStages,
  FileProgressInfo,
  BulkImportStatus,
  ResumableJobSummary,
} from '../types/MastTypes';
import { mastService, ApiError } from '../services';
import './MastSearch.css';

// Maximum number of concurrent observation imports
const MAX_CONCURRENT_IMPORTS = 3;

// Helper function to format bytes as human-readable string
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

// Helper function to format ETA
const formatEta = (seconds: number | undefined | null): string => {
  if (!seconds || seconds <= 0) return '--:--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

// Find the longest common prefix across all strings.
const getCommonPrefix = (strings: string[]): string => {
  if (strings.length <= 1) return '';
  let prefix = strings[0];
  for (const s of strings) {
    while (prefix && !s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return '';
  }
  return prefix;
};

// Longest common prefix of exactly two strings.
const lcpOfTwo = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

// A cluster of files sharing a sub-prefix within the tree.
interface FileGroup {
  subPrefix: string;
  items: Array<{ displayName: string; fp: FileProgressInfo }>;
}

// After extracting the global common prefix, cluster suffixes that share a
// further sub-prefix (≥ MIN_SUB chars) so we can fold it into a sub-node.
const MIN_SUB = 8;

const groupFilesBySuffix = (
  fileProgress: FileProgressInfo[],
  globalPrefix: string
): FileGroup[] => {
  const entries = fileProgress.map((fp) => ({
    suffix: fp.filename.slice(globalPrefix.length),
    fp,
  }));

  if (entries.length <= 1) {
    return entries.map((e) => ({
      subPrefix: '',
      items: [{ displayName: e.suffix || e.fp.filename, fp: e.fp }],
    }));
  }

  const sorted = [...entries].sort((a, b) => a.suffix.localeCompare(b.suffix));

  const groups: FileGroup[] = [];
  let current = [sorted[0]];
  let groupLcp = sorted[0].suffix;

  for (let i = 1; i < sorted.length; i++) {
    const newLcp = lcpOfTwo(groupLcp, sorted[i].suffix);
    if (newLcp.length >= MIN_SUB) {
      groupLcp = newLcp;
      current.push(sorted[i]);
    } else {
      groups.push(buildFileGroup(current));
      current = [sorted[i]];
      groupLcp = sorted[i].suffix;
    }
  }
  groups.push(buildFileGroup(current));
  return groups;
};

const buildFileGroup = (entries: Array<{ suffix: string; fp: FileProgressInfo }>): FileGroup => {
  if (entries.length <= 1) {
    return {
      subPrefix: '',
      items: entries.map((e) => ({
        displayName: e.suffix || e.fp.filename,
        fp: e.fp,
      })),
    };
  }
  const prefix = getCommonPrefix(entries.map((e) => e.suffix));
  return {
    subPrefix: prefix,
    items: entries.map((e) => ({
      displayName: e.suffix.slice(prefix.length) || e.suffix,
      fp: e.fp,
    })),
  };
};

// Summarise a group's progress for the collapsed view, e.g. "3/6 ✓  1 ↓"
const summariseGroup = (items: Array<{ fp: FileProgressInfo }>): string => {
  const total = items.length;
  const done = items.filter((i) => i.fp.status === 'complete').length;
  const downloading = items.filter((i) => i.fp.status === 'downloading').length;
  const failed = items.filter((i) => i.fp.status === 'failed').length;
  const parts: string[] = [];
  if (done > 0) parts.push(`${done}/${total} ✓`);
  if (downloading > 0) parts.push(`${downloading} ↓`);
  if (failed > 0) parts.push(`${failed} ✗`);
  if (parts.length === 0) parts.push(`0/${total}`);
  return parts.join('  ');
};

interface MastSearchProps {
  onImportComplete: () => void;
  /** Set of observation IDs that have already been imported */
  importedObsIds?: Set<string>;
}

const SEARCH_TIMEOUT_MS = 120000; // 2 minutes

const MastSearch: React.FC<MastSearchProps> = ({ onImportComplete, importedObsIds }) => {
  const [searchType, setSearchType] = useState<MastSearchType>('target');
  const [targetName, setTargetName] = useState('');
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [radius, setRadius] = useState('0.2');
  const [obsId, setObsId] = useState('');
  const [programId, setProgramId] = useState('');
  const [showAllCalibLevels, setShowAllCalibLevels] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MastObservationResult[]>([]);
  const [selectedObs, setSelectedObs] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bulkImportStatus, setBulkImportStatus] = useState<BulkImportStatus | null>(null);
  const [resumableJobs, setResumableJobs] = useState<ResumableJobSummary[]>([]);
  const [resumableCollapsed, setResumableCollapsed] = useState(true);
  const [expandedFileGroups, setExpandedFileGroups] = useState<Set<string>>(new Set());

  // Ref to track if polling should continue (prevents modal from reopening after close)
  const shouldPollRef = useRef(true);

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

  // Fetch resumable (incomplete) downloads on mount
  useEffect(() => {
    refreshResumableJobs();
  }, []);

  const handleResumeFromPanel = (job: ResumableJobSummary) => {
    // Remove from the resumable list immediately
    setResumableJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
    // Delegate to existing resume handler
    handleResumeImport(job.jobId, job.obsId);
  };

  const handleDismissDownload = async (job: ResumableJobSummary) => {
    const hasCompletedFiles = job.completedFiles > 0;
    let deleteFiles = false;

    if (hasCompletedFiles) {
      deleteFiles = window.confirm(
        `This download has ${job.completedFiles} completed file(s). Delete them too?\n\nOK = Delete files\nCancel = Keep files, just remove from list`
      );
    }

    try {
      await mastService.dismissResumableImport(job.jobId, deleteFiles);
      setResumableJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
    } catch (err) {
      console.error('Failed to dismiss download:', err);
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
        // Handle timeout errors from backend
        if (err.status === 504) {
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

  const pollImportProgress = useCallback(async (jobId: string): Promise<ImportJobStatus> => {
    return mastService.getImportProgress(jobId);
  }, []);

  const handleImport = async (obsIdToImport: string) => {
    shouldPollRef.current = true; // Enable polling for this import
    setImporting(obsIdToImport);
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
      // For observation ID searches, import all levels; otherwise respect the toggle
      const calibLevel =
        searchType === 'observation' ? undefined : showAllCalibLevels ? [1, 2, 3] : [3];

      // Start the import job
      const startData = await mastService.startImport({
        obsId: obsIdToImport,
        productType: 'SCIENCE',
        tags: ['mast-import'],
        calibLevel,
      });
      const jobId = startData.jobId;

      // Poll for progress
      const pollInterval = 500; // 500ms
      const maxPolls = 1200; // 10 minutes max (1200 * 500ms)
      let pollCount = 0;

      while (pollCount < maxPolls && shouldPollRef.current) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        pollCount++;

        // Check if polling was stopped (e.g., modal was closed)
        if (!shouldPollRef.current) break;

        try {
          const status = await pollImportProgress(jobId);

          // Check again after async call in case modal was closed
          if (!shouldPollRef.current) break;

          setImportProgress(status);

          if (status.isComplete) {
            if (status.error) {
              // Job failed - don't close modal automatically
              break;
            } else if (status.result) {
              // Job succeeded
              if (status.result.importedCount > 0) {
                onImportComplete();
              }
              break;
            }
          }
        } catch (pollError) {
          console.error('Poll error:', pollError);
          // Continue polling even if one poll fails
        }
      }

      if (pollCount >= maxPolls) {
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                stage: ImportStages.Failed,
                message: 'Import timed out. Check server logs.',
                isComplete: true,
                error: 'Import timed out after 10 minutes',
              }
            : null
        );
      }
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
    } finally {
      setImporting(null);
    }
  };

  const closeProgressModal = () => {
    shouldPollRef.current = false; // Stop any ongoing polling
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
    shouldPollRef.current = true; // Enable polling for this import
    setImporting(obsIdToResume);
    setImportProgress((prev) =>
      prev
        ? {
            ...prev,
            stage: ImportStages.Downloading,
            message: 'Resuming download...',
            isComplete: false,
            error: undefined,
          }
        : {
            jobId,
            obsId: obsIdToResume,
            progress: 0,
            stage: ImportStages.Downloading,
            message: 'Resuming download...',
            isComplete: false,
            startedAt: new Date().toISOString(),
          }
    );

    try {
      // Call resume endpoint
      const resumeData = await mastService.resumeImport(jobId);

      // The backend may return a new import tracker job ID (e.g., when resuming
      // from a processing engine download job ID after a backend restart)
      const pollingJobId = (resumeData as unknown as { jobId?: string }).jobId || jobId;

      // Check if resume found existing files
      if ((resumeData as unknown as { filesFound?: number }).filesFound) {
        const filesFound = (resumeData as unknown as { filesFound: number }).filesFound;
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                jobId: pollingJobId,
                stage: ImportStages.SavingRecords,
                message: `Found ${filesFound} downloaded files, creating records...`,
                progress: 45,
              }
            : null
        );
      }

      // Poll for progress using the job ID from the response
      const pollInterval = 500;
      const maxPolls = 1200;
      let pollCount = 0;

      while (pollCount < maxPolls && shouldPollRef.current) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        pollCount++;

        // Check if polling was stopped (e.g., modal was closed)
        if (!shouldPollRef.current) break;

        try {
          const status = await pollImportProgress(pollingJobId);

          // Check again after async call in case modal was closed
          if (!shouldPollRef.current) break;

          setImportProgress(status);

          if (status.isComplete) {
            if (status.error) {
              break;
            } else if (status.result) {
              if (status.result.importedCount > 0) {
                onImportComplete();
              }
              break;
            }
          }
        } catch (pollError) {
          console.error('Poll error:', pollError);
        }
      }

      if (pollCount >= maxPolls && shouldPollRef.current) {
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                stage: ImportStages.Failed,
                message: 'Resume timed out. Check server logs.',
                isComplete: true,
                error: 'Resume timed out after 10 minutes',
                isResumable: true,
              }
            : null
        );
      }
    } catch (err) {
      if (!shouldPollRef.current) return; // Don't show error if modal was closed

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
    } finally {
      setImporting(null);
    }
  };

  // Import from files that already exist on disk
  const handleImportFromExisting = async (obsIdToImport: string) => {
    shouldPollRef.current = true; // Enable polling for this import
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
      const jobId = startData.jobId;

      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              jobId,
              message: startData.message,
              progress: 45,
            }
          : null
      );

      // Poll for progress
      const pollInterval = 500;
      const maxPolls = 600; // 5 minutes should be enough for just creating records
      let pollCount = 0;

      while (pollCount < maxPolls && shouldPollRef.current) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        pollCount++;

        // Check if polling was stopped (e.g., modal was closed)
        if (!shouldPollRef.current) break;

        try {
          const status = await pollImportProgress(jobId);

          // Check again after async call in case modal was closed
          if (!shouldPollRef.current) break;

          setImportProgress(status);

          if (status.isComplete) {
            if (!status.error && status.result && status.result.importedCount > 0) {
              onImportComplete();
            }
            break;
          }
        } catch (pollError) {
          console.error('Poll error:', pollError);
        }
      }
    } catch (err) {
      if (!shouldPollRef.current) return; // Don't show error if modal was closed

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

  // Process a single observation for bulk import (updates bulkImportStatus)
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
      });
      const jobId = startData.jobId;

      // Update with job ID
      setBulkImportStatus((prev) => {
        if (!prev) return prev;
        const newJobs = new Map(prev.jobs);
        const job = newJobs.get(obsIdToImport);
        if (job) {
          newJobs.set(obsIdToImport, { ...job, jobId });
        }
        return { ...prev, jobs: newJobs };
      });

      // Poll for progress
      const pollInterval = 500;
      const maxPolls = 1200; // 10 minutes max

      for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        try {
          const status = await pollImportProgress(jobId);

          // Update this job in bulk status
          setBulkImportStatus((prev) => {
            if (!prev) return prev;
            const newJobs = new Map(prev.jobs);
            newJobs.set(obsIdToImport, status);
            return { ...prev, jobs: newJobs };
          });

          if (status.isComplete) {
            if (status.error) {
              // Mark as failed
              setBulkImportStatus((prev) => {
                if (!prev) return prev;
                return { ...prev, failedCount: prev.failedCount + 1 };
              });
            } else if (status.result) {
              // Mark as complete (don't call onImportComplete here - wait for all jobs)
              setBulkImportStatus((prev) => {
                if (!prev) return prev;
                return { ...prev, completedCount: prev.completedCount + 1 };
              });
              // Note: onImportComplete is called once after ALL bulk jobs complete
              // in handleBulkImport, not here. Calling it here would trigger a data
              // refresh that unmounts the modal before all jobs finish.
            }
            return;
          }
        } catch (pollError) {
          console.error('Poll error for', obsIdToImport, ':', pollError);
          // Continue polling even if one poll fails
        }
      }

      // Timeout reached
      setBulkImportStatus((prev) => {
        if (!prev) return prev;
        const newJobs = new Map(prev.jobs);
        const job = newJobs.get(obsIdToImport);
        if (job) {
          newJobs.set(obsIdToImport, {
            ...job,
            stage: ImportStages.Failed,
            message: 'Import timed out',
            isComplete: true,
            error: 'Import timed out after 10 minutes',
          });
        }
        return { ...prev, failedCount: prev.failedCount + 1, jobs: newJobs };
      });
    } catch (err) {
      // Mark as failed
      setBulkImportStatus((prev) => {
        if (!prev) return prev;
        const newJobs = new Map(prev.jobs);
        const job = newJobs.get(obsIdToImport);
        if (job) {
          newJobs.set(obsIdToImport, {
            ...job,
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

    // Refresh data once after all bulk imports complete
    // This is done here instead of per-job to avoid unmounting the modal mid-import
    onImportComplete();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatExposureTime = (expTime: number | undefined) => {
    if (expTime === undefined || expTime === null) return '-';
    if (expTime < 1) return `${(expTime * 1000).toFixed(0)}ms`;
    if (expTime < 60) return `${expTime.toFixed(1)}s`;
    return `${(expTime / 60).toFixed(1)}m`;
  };

  const formatDate = (dateValue: string | number | undefined) => {
    if (dateValue === undefined || dateValue === null) return '-';
    try {
      // MAST returns dates as Modified Julian Date (MJD) numbers
      // MJD 0 = November 17, 1858; Unix epoch (Jan 1, 1970) = MJD 40587
      if (typeof dateValue === 'number') {
        const unixMs = (dateValue - 40587) * 86400 * 1000;
        return new Date(unixMs).toLocaleDateString();
      }
      return new Date(dateValue).toLocaleDateString();
    } catch {
      return String(dateValue);
    }
  };

  return (
    <div className="mast-search">
      <h2>MAST Portal Search</h2>
      <p className="mast-description">
        Search the Mikulski Archive for Space Telescopes (MAST) for JWST observations
      </p>

      <div className="search-type-selector">
        <label className={searchType === 'target' ? 'selected' : ''}>
          <input
            type="radio"
            value="target"
            checked={searchType === 'target'}
            onChange={() => setSearchType('target')}
          />
          Target Name
        </label>
        <label className={searchType === 'coordinates' ? 'selected' : ''}>
          <input
            type="radio"
            value="coordinates"
            checked={searchType === 'coordinates'}
            onChange={() => setSearchType('coordinates')}
          />
          Coordinates
        </label>
        <label className={searchType === 'observation' ? 'selected' : ''}>
          <input
            type="radio"
            value="observation"
            checked={searchType === 'observation'}
            onChange={() => setSearchType('observation')}
          />
          Observation ID
        </label>
        <label className={searchType === 'program' ? 'selected' : ''}>
          <input
            type="radio"
            value="program"
            checked={searchType === 'program'}
            onChange={() => setSearchType('program')}
          />
          Program ID
        </label>
      </div>

      {/* Calibration level filter - hidden for observation ID searches */}
      {searchType !== 'observation' && (
        <div className="search-options">
          <label className="calib-level-toggle">
            <input
              type="checkbox"
              checked={showAllCalibLevels}
              onChange={(e) => setShowAllCalibLevels(e.target.checked)}
            />
            <span className="toggle-label">Show all calibration levels</span>
            <span className="toggle-hint">
              {showAllCalibLevels
                ? '(Levels 1-3: includes individual exposures)'
                : '(Level 3 only: combined/mosaic images)'}
            </span>
          </label>
        </div>
      )}

      <div className="search-inputs">
        {searchType === 'target' && (
          <>
            <input
              type="text"
              placeholder="Target name (e.g., NGC 3132, Carina Nebula)"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              onKeyPress={handleKeyPress}
              className="search-input-main"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              step="0.1"
              min="0.01"
              max="10"
              className="search-input-small"
            />
          </>
        )}

        {searchType === 'coordinates' && (
          <>
            <input
              type="number"
              placeholder="RA (degrees)"
              value={ra}
              onChange={(e) => setRa(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Dec (degrees)"
              value={dec}
              onChange={(e) => setDec(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              step="0.1"
              className="search-input-small"
            />
          </>
        )}

        {searchType === 'observation' && (
          <input
            type="text"
            placeholder="Observation ID (e.g., jw02729-o001_s00001)"
            value={obsId}
            onChange={(e) => setObsId(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        {searchType === 'program' && (
          <input
            type="text"
            placeholder="Program ID (e.g., 2729)"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        <button
          onClick={handleSearch}
          disabled={loading}
          className={`search-button ${loading ? 'searching' : ''}`}
        >
          {loading ? (
            <>
              <span className="search-spinner" />
              Searching MAST...
            </>
          ) : (
            'Search MAST'
          )}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Resumable (Incomplete) Downloads Section */}
      {resumableJobs.length > 0 && (
        <div className="resumable-section">
          <div
            className="resumable-header"
            onClick={() => setResumableCollapsed(!resumableCollapsed)}
            style={{ cursor: 'pointer' }}
          >
            <h3>
              <span className={`resumable-chevron ${resumableCollapsed ? '' : 'open'}`}>
                {'\u25B6'}
              </span>{' '}
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
                      className="resumable-resume-btn"
                      onClick={() => handleResumeFromPanel(job)}
                      disabled={importing !== null}
                    >
                      Resume
                    </button>
                    <button
                      className="resumable-dismiss-btn"
                      onClick={() => handleDismissDownload(job)}
                      title="Dismiss this download"
                    >
                      {'\u2715'}
                    </button>
                  </div>
                );
              })}
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="search-results">
          <div className="results-header">
            <h3>Search Results ({searchResults.length})</h3>
            {selectedObs.size > 0 && (
              <button
                className="bulk-import-btn"
                onClick={handleBulkImport}
                disabled={importing !== null}
              >
                Import Selected ({selectedObs.size})
              </button>
            )}
          </div>

          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th className="col-checkbox"></th>
                  <th className="col-obs-id">Obs ID</th>
                  <th className="col-target">Target</th>
                  <th className="col-instrument">Instrument</th>
                  <th className="col-filter">Filter</th>
                  <th className="col-exptime">Exp Time</th>
                  <th className="col-date">Obs Date</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedResults.map((result, index) => {
                  const resultObsId = result.obs_id || `result-${startIndex + index}`;
                  return (
                    <tr key={resultObsId}>
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedObs.has(resultObsId)}
                          onChange={() => toggleSelection(resultObsId)}
                          disabled={!result.obs_id}
                        />
                      </td>
                      <td className="col-obs-id" title={result.obs_id}>
                        {result.obs_id || '-'}
                      </td>
                      <td className="col-target" title={result.target_name}>
                        {result.target_name || '-'}
                      </td>
                      <td className="col-instrument">{result.instrument_name || '-'}</td>
                      <td className="col-filter" title={result.filters}>
                        {result.filters || '-'}
                      </td>
                      <td className="col-exptime">{formatExposureTime(result.t_exptime)}</td>
                      <td className="col-date">{formatDate(result.t_min)}</td>
                      <td className="col-actions">
                        {result.obs_id && importedObsIds?.has(result.obs_id) ? (
                          <button className="import-btn imported" disabled>
                            Imported
                          </button>
                        ) : (
                          <button
                            onClick={() => result.obs_id && handleImport(result.obs_id)}
                            disabled={importing === result.obs_id || !result.obs_id}
                            className="import-btn"
                          >
                            {importing === result.obs_id ? 'Importing...' : 'Import'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination">
              <div className="pagination-info">
                Showing {startIndex + 1}-{Math.min(endIndex, searchResults.length)} of{' '}
                {searchResults.length} results
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                  title="First page"
                >
                  ««
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                  title="Previous page"
                >
                  «
                </button>
                <span className="pagination-pages">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                  title="Next page"
                >
                  »
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                  title="Last page"
                >
                  »»
                </button>
              </div>
              <div className="pagination-size">
                <label htmlFor="page-size">Per page:</label>
                <select
                  id="page-size"
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import Progress Modal */}
      {importProgress && (
        <div className="import-progress-overlay">
          <div className="import-progress-container">
            <div className="import-progress-header">
              <h3 className="import-progress-title">Importing from MAST</h3>
              <span className="import-progress-percent">
                {importProgress.downloadProgressPercent != null
                  ? `${importProgress.downloadProgressPercent.toFixed(1)}%`
                  : `${importProgress.progress}%`}
              </span>
            </div>

            <div className="progress-bar-container">
              <div
                className={`progress-bar-fill ${
                  importProgress.stage === ImportStages.Complete
                    ? 'complete'
                    : importProgress.stage === ImportStages.Failed
                      ? 'failed'
                      : ''
                }`}
                style={{
                  width: `${importProgress.downloadProgressPercent ?? importProgress.progress}%`,
                }}
              />
            </div>

            <p className="import-progress-stage">
              {!importProgress.isComplete && <span className="spinner" />}
              {importProgress.stage === ImportStages.Downloading &&
              importProgress.totalBytes &&
              importProgress.totalBytes > 0
                ? 'Downloading...'
                : importProgress.message}
            </p>

            {/* Byte-level progress details */}
            {importProgress.totalBytes !== undefined && importProgress.totalBytes > 0 && (
              <div className="download-details">
                <span className="download-bytes">
                  {formatBytes(importProgress.downloadedBytes ?? 0)} /{' '}
                  {formatBytes(importProgress.totalBytes)}
                </span>
                {importProgress.speedBytesPerSec !== undefined &&
                  importProgress.speedBytesPerSec > 0 && (
                    <span className="download-speed">
                      {formatBytes(importProgress.speedBytesPerSec)}/s
                    </span>
                  )}
                {importProgress.etaSeconds !== undefined && importProgress.etaSeconds > 0 && (
                  <span className="download-eta">ETA: {formatEta(importProgress.etaSeconds)}</span>
                )}
              </div>
            )}

            {/* Per-file progress tree */}
            {importProgress.fileProgress &&
              importProgress.fileProgress.length > 0 &&
              (() => {
                const filenames = importProgress.fileProgress.map(
                  (fp: FileProgressInfo) => fp.filename
                );
                const commonPrefix = getCommonPrefix(filenames);
                const groups = commonPrefix
                  ? groupFilesBySuffix(importProgress.fileProgress, commonPrefix)
                  : [
                      {
                        subPrefix: '',
                        items: importProgress.fileProgress.map((fp: FileProgressInfo) => ({
                          displayName: fp.filename,
                          fp,
                        })),
                      },
                    ];
                const totalGroups = groups.length;

                return (
                  <div className="file-progress-list">
                    <div className="file-progress-header">
                      {commonPrefix ? (
                        <span className="file-progress-tree-root" title={commonPrefix}>
                          {commonPrefix}
                        </span>
                      ) : (
                        'File Progress'
                      )}
                    </div>
                    {groups.map((group, gIdx) => {
                      const isLastGroup = gIdx === totalGroups - 1;
                      const rootChar = isLastGroup ? '└' : '├';
                      const nestChar = isLastGroup ? '\u00A0' : '│';

                      if (group.subPrefix && group.items.length > 1) {
                        const groupKey = group.subPrefix;
                        const isExpanded = expandedFileGroups.has(groupKey);
                        const toggleGroup = () =>
                          setExpandedFileGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(groupKey)) next.delete(groupKey);
                            else next.add(groupKey);
                            return next;
                          });

                        return (
                          <React.Fragment key={`g-${gIdx}`}>
                            <div className="file-tree-subgroup" onClick={toggleGroup}>
                              <span className="file-tree-connector">{rootChar}</span>
                              <span className="file-tree-toggle">{isExpanded ? '▾' : '▸'}</span>
                              <span className="file-tree-subprefix">{group.subPrefix}</span>
                              {!isExpanded && (
                                <span className="file-tree-summary">
                                  {summariseGroup(group.items)}
                                </span>
                              )}
                            </div>
                            {isExpanded &&
                              group.items.map((item, iIdx) => {
                                const isLastItem = iIdx === group.items.length - 1;
                                return (
                                  <div
                                    key={item.fp.filename}
                                    className={`file-progress-item ${item.fp.status}`}
                                  >
                                    <span className="file-tree-connector">
                                      {nestChar}
                                      {isLastItem ? '└' : '├'}
                                    </span>
                                    <span className="file-name" title={item.fp.filename}>
                                      {item.displayName}
                                    </span>
                                    <div className="file-progress-bar">
                                      <div
                                        className={`file-progress-fill ${item.fp.status}`}
                                        style={{
                                          width: `${item.fp.progressPercent ?? 0}%`,
                                        }}
                                      />
                                    </div>
                                    <span className="file-status">
                                      {item.fp.status === 'complete'
                                        ? '✓'
                                        : item.fp.status === 'downloading'
                                          ? `${(item.fp.progressPercent ?? 0).toFixed(0)}%`
                                          : item.fp.status === 'failed'
                                            ? '✗'
                                            : item.fp.status === 'paused'
                                              ? '⏸'
                                              : '○'}
                                    </span>
                                  </div>
                                );
                              })}
                          </React.Fragment>
                        );
                      }

                      // Singleton — direct child of root
                      const item = group.items[0];
                      return (
                        <div
                          key={item.fp.filename}
                          className={`file-progress-item ${item.fp.status}`}
                        >
                          {commonPrefix && <span className="file-tree-connector">{rootChar}</span>}
                          <span className="file-name" title={item.fp.filename}>
                            {item.displayName}
                          </span>
                          <div className="file-progress-bar">
                            <div
                              className={`file-progress-fill ${item.fp.status}`}
                              style={{
                                width: `${item.fp.progressPercent ?? 0}%`,
                              }}
                            />
                          </div>
                          <span className="file-status">
                            {item.fp.status === 'complete'
                              ? '✓'
                              : item.fp.status === 'downloading'
                                ? `${(item.fp.progressPercent ?? 0).toFixed(0)}%`
                                : item.fp.status === 'failed'
                                  ? '✗'
                                  : item.fp.status === 'paused'
                                    ? '⏸'
                                    : '○'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            <p className="import-progress-obs-id">Observation: {importProgress.obsId}</p>

            {importProgress.error && (
              <div className="import-progress-error">
                {importProgress.error}
                {importProgress.isResumable &&
                  importProgress.downloadedBytes != null &&
                  importProgress.totalBytes != null && (
                    <p className="import-progress-resumable">
                      Download can be resumed from {formatBytes(importProgress.downloadedBytes)} of{' '}
                      {formatBytes(importProgress.totalBytes)}.
                    </p>
                  )}
                {importProgress.isResumable &&
                  (importProgress.downloadedBytes == null || importProgress.totalBytes == null) && (
                    <p className="import-progress-resumable">This download can be resumed.</p>
                  )}
              </div>
            )}

            {importProgress.isComplete && !importProgress.error && importProgress.result && (
              <p className="import-progress-success">
                Successfully imported {importProgress.result.importedCount} file(s)
              </p>
            )}

            <div className="import-progress-actions">
              {!importProgress.isComplete && importProgress.jobId && (
                <button
                  className="import-cancel-btn"
                  onClick={handleCancelImport}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Import'}
                </button>
              )}
              {importProgress.isComplete && (
                <button className="import-progress-close" onClick={closeProgressModal}>
                  Close
                </button>
              )}
              {importProgress.isResumable && importProgress.error && importProgress.jobId && (
                <button
                  className="import-resume-btn"
                  onClick={() => {
                    if (importProgress.jobId && importProgress.obsId) {
                      handleResumeImport(importProgress.jobId, importProgress.obsId);
                    }
                  }}
                >
                  Resume Download
                </button>
              )}
              {importProgress.error && !importProgress.isResumable && (
                <button
                  className="import-resume-btn"
                  onClick={() => {
                    closeProgressModal();
                    if (importProgress.obsId) {
                      handleImport(importProgress.obsId);
                    }
                  }}
                >
                  Retry Import
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Progress Modal */}
      {bulkImportStatus && (
        <div className="import-progress-overlay">
          <div className="import-progress-container bulk-import-modal">
            <div className="import-progress-header">
              <h3 className="import-progress-title">Bulk Import Progress</h3>
              <span className="import-progress-percent">
                {bulkImportStatus.completedCount} / {bulkImportStatus.totalCount}
              </span>
            </div>

            {/* Overall Progress */}
            <div className="bulk-overall-progress">
              <div className="progress-bar-container">
                <div
                  className={`progress-bar-fill ${
                    !bulkImportStatus.isActive && bulkImportStatus.failedCount === 0
                      ? 'complete'
                      : !bulkImportStatus.isActive && bulkImportStatus.failedCount > 0
                        ? 'partial'
                        : ''
                  }`}
                  style={{
                    width: `${((bulkImportStatus.completedCount + bulkImportStatus.failedCount) / bulkImportStatus.totalCount) * 100}%`,
                  }}
                />
              </div>
              <div className="bulk-progress-stats">
                <span className="bulk-stat completed">
                  {bulkImportStatus.completedCount} completed
                </span>
                {bulkImportStatus.failedCount > 0 && (
                  <span className="bulk-stat failed">{bulkImportStatus.failedCount} failed</span>
                )}
                {bulkImportStatus.pendingObsIds.length > 0 && (
                  <span className="bulk-stat pending">
                    {bulkImportStatus.pendingObsIds.length} pending
                  </span>
                )}
              </div>
            </div>

            {/* Active Jobs List */}
            <div className="bulk-jobs-list">
              <div className="bulk-jobs-header">Active Downloads</div>
              {Array.from(bulkImportStatus.jobs.entries()).map(([obsId, job], index) => {
                // Extract unique identifier from obs_id (last two segments for uniqueness)
                const obsIdParts = obsId.split('_');
                const uniquePart =
                  obsIdParts.length > 2 ? obsIdParts.slice(-2).join('_') : obsId.slice(-15);

                return (
                  <div
                    key={obsId}
                    className={`bulk-job-row ${job.isComplete ? (job.error ? 'failed' : 'complete') : 'active'}`}
                  >
                    {/* Row number for quick identification */}
                    <span className="bulk-job-index">{index + 1}.</span>

                    {/* Shorter, unique identifier */}
                    <span className="bulk-job-obs-id" title={obsId}>
                      {uniquePart}
                    </span>

                    {/* Progress section: bar + percentage */}
                    {!job.isComplete && (
                      <div className="bulk-job-progress">
                        <div className="bulk-job-progress-bar">
                          <div
                            className="bulk-job-progress-fill"
                            style={{ width: `${job.downloadProgressPercent ?? 0}%` }}
                          />
                        </div>
                        <span className="bulk-job-percent">
                          {(job.downloadProgressPercent ?? 0).toFixed(0)}%
                        </span>
                      </div>
                    )}

                    {/* Speed when downloading */}
                    {!job.isComplete &&
                      job.speedBytesPerSec !== undefined &&
                      job.speedBytesPerSec > 0 && (
                        <span className="bulk-job-speed">
                          {formatBytes(job.speedBytesPerSec)}/s
                        </span>
                      )}

                    {/* Status icons for complete/failed */}
                    {job.isComplete && !job.error && (
                      <span className="bulk-job-status-icon complete">✓</span>
                    )}
                    {job.error && (
                      <>
                        <span className="bulk-job-error-msg" title={job.error}>
                          {job.error.length > 30 ? `${job.error.slice(0, 30)}...` : job.error}
                        </span>
                        <span className="bulk-job-status-icon failed">✗</span>
                      </>
                    )}
                  </div>
                );
              })}
              {bulkImportStatus.jobs.size === 0 && bulkImportStatus.pendingObsIds.length > 0 && (
                <div className="bulk-job-row pending">
                  <span className="bulk-job-loading">Starting imports...</span>
                </div>
              )}
            </div>

            {/* Pending Queue */}
            {bulkImportStatus.pendingObsIds.length > 0 && (
              <div className="bulk-pending-queue">
                <span className="bulk-pending-label">
                  Queued: {bulkImportStatus.pendingObsIds.length} observation
                  {bulkImportStatus.pendingObsIds.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* Close button (only when complete) */}
            <div className="import-progress-actions">
              {!bulkImportStatus.isActive && (
                <button className="import-progress-close" onClick={() => setBulkImportStatus(null)}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MastSearch;
