import React, { useState, useCallback, useRef } from 'react';
import {
  MastSearchType,
  MastObservationResult,
  ImportJobStatus,
  ImportStages,
  FileProgressInfo,
} from '../types/MastTypes';
import { mastService, ApiError } from '../services';
import './MastSearch.css';

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

interface MastSearchProps {
  onImportComplete: () => void;
}

const SEARCH_TIMEOUT_MS = 120000; // 2 minutes

const MastSearch: React.FC<MastSearchProps> = ({ onImportComplete }) => {
  const [searchType, setSearchType] = useState<MastSearchType>('target');
  const [targetName, setTargetName] = useState('');
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [radius, setRadius] = useState('0.2');
  const [obsId, setObsId] = useState('');
  const [programId, setProgramId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MastObservationResult[]>([]);
  const [selectedObs, setSelectedObs] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

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

      switch (searchType) {
        case 'target':
          if (!targetName.trim()) {
            setError('Please enter a target name');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          data = await mastService.searchByTarget(
            { targetName: targetName.trim(), radius: parseFloat(radius) },
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
            { ra: parseFloat(ra), dec: parseFloat(dec), radius: parseFloat(radius) },
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
            { programId: programId.trim() },
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
      // Start the import job
      const startData = await mastService.startImport({
        obsId: obsIdToImport,
        productType: 'SCIENCE',
        tags: ['mast-import'],
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

      // Check if resume found existing files
      if ((resumeData as unknown as { filesFound?: number }).filesFound) {
        const filesFound = (resumeData as unknown as { filesFound: number }).filesFound;
        setImportProgress((prev) =>
          prev
            ? {
                ...prev,
                stage: ImportStages.SavingRecords,
                message: `Found ${filesFound} downloaded files, creating records...`,
                progress: 45,
              }
            : null
        );
      }

      // Poll for progress
      const pollInterval = 500;
      const maxPolls = 1200;
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
        console.log('Job not found, checking for existing files...');
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

  const handleBulkImport = async () => {
    const obsIds = Array.from(selectedObs);
    for (const id of obsIds) {
      await handleImport(id);
    }
    setSelectedObs(new Set());
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
                        <button
                          onClick={() => result.obs_id && handleImport(result.obs_id)}
                          disabled={importing === result.obs_id || !result.obs_id}
                          className="import-btn"
                        >
                          {importing === result.obs_id ? 'Importing...' : 'Import'}
                        </button>
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

            {/* Per-file progress list */}
            {importProgress.fileProgress && importProgress.fileProgress.length > 0 && (
              <div className="file-progress-list">
                <div className="file-progress-header">File Progress</div>
                {importProgress.fileProgress.map((fp: FileProgressInfo) => (
                  <div key={fp.filename} className={`file-progress-item ${fp.status}`}>
                    <span className="file-name" title={fp.filename}>
                      {fp.filename.length > 30 ? `...${fp.filename.slice(-30)}` : fp.filename}
                    </span>
                    <div className="file-progress-bar">
                      <div
                        className={`file-progress-fill ${fp.status}`}
                        style={{ width: `${fp.progressPercent ?? 0}%` }}
                      />
                    </div>
                    <span className="file-status">
                      {fp.status === 'complete'
                        ? '✓'
                        : fp.status === 'downloading'
                          ? `${(fp.progressPercent ?? 0).toFixed(0)}%`
                          : fp.status === 'failed'
                            ? '✗'
                            : fp.status === 'paused'
                              ? '⏸'
                              : '○'}
                    </span>
                  </div>
                ))}
              </div>
            )}

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
    </div>
  );
};

export default MastSearch;
