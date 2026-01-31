import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  MastObservationResult,
  ImportJobStatus,
  ImportStages,
  FileProgressInfo
} from '../types/MastTypes';
import { mastService, ApiError } from '../services';
import './WhatsNewPanel.css';

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

// Helper to format MJD date
const formatMjdDate = (mjd: number | undefined): string => {
  if (mjd === undefined || mjd === null) return '-';
  try {
    // MJD 0 = November 17, 1858; Unix epoch (Jan 1, 1970) = MJD 40587
    const unixMs = (mjd - 40587) * 86400 * 1000;
    return new Date(unixMs).toLocaleDateString();
  } catch {
    return String(mjd);
  }
};

const formatExposureTime = (expTime: number | undefined) => {
  if (expTime === undefined || expTime === null) return '-';
  if (expTime < 1) return `${(expTime * 1000).toFixed(0)}ms`;
  if (expTime < 60) return `${expTime.toFixed(1)}s`;
  return `${(expTime / 60).toFixed(1)}m`;
};

interface WhatsNewPanelProps {
  onImportComplete: () => void;
}

type DaysOption = 7 | 30 | 90;

const INSTRUMENTS = ['NIRCAM', 'MIRI', 'NIRSPEC', 'NIRISS'];

const WhatsNewPanel: React.FC<WhatsNewPanelProps> = ({ onImportComplete }) => {
  const [daysBack, setDaysBack] = useState<DaysOption>(30);
  const [instrument, setInstrument] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MastObservationResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set());

  const shouldPollRef = useRef(true);
  const LIMIT = 20;

  const fetchResults = useCallback(async (reset = false) => {
    setLoading(true);
    setError(null);

    const newOffset = reset ? 0 : offset;

    try {
      const data = await mastService.getRecentReleases({
        daysBack,
        instrument: instrument || undefined,
        limit: LIMIT,
        offset: newOffset,
      });

      if (reset) {
        setResults(data.results);
        setOffset(LIMIT);
      } else {
        setResults(prev => [...prev, ...data.results]);
        setOffset(prev => prev + LIMIT);
      }

      setHasMore(data.results.length === LIMIT);

      if (data.results.length === 0 && reset) {
        setError('No recent observations found for the selected filters');
      }
    } catch (err) {
      if (ApiError.isApiError(err)) {
        if (err.status === 504) {
          setError('Search timed out. Try a smaller time range or add an instrument filter.');
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch recent releases');
      }
    } finally {
      setLoading(false);
    }
  }, [daysBack, instrument, offset]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchResults(true);
    // Reset failed thumbnails when filters change
    setFailedThumbnails(new Set());
  }, [daysBack, instrument]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    setOffset(0);
    setFailedThumbnails(new Set());
    fetchResults(true);
  };

  const handleLoadMore = () => {
    fetchResults(false);
  };

  const handleThumbnailError = (obsId: string) => {
    setFailedThumbnails(prev => new Set(prev).add(obsId));
  };

  const pollImportProgress = useCallback(async (jobId: string): Promise<ImportJobStatus> => {
    return mastService.getImportProgress(jobId);
  }, []);

  const handleImport = async (obsIdToImport: string) => {
    shouldPollRef.current = true;
    setImporting(obsIdToImport);
    setImportProgress({
      jobId: '',
      obsId: obsIdToImport,
      progress: 0,
      stage: ImportStages.Starting,
      message: 'Starting import...',
      isComplete: false,
      startedAt: new Date().toISOString()
    });

    try {
      const startData = await mastService.startImport({
        obsId: obsIdToImport,
        productType: 'SCIENCE',
        tags: ['mast-import', 'whats-new']
      });
      const jobId = startData.jobId;

      const pollInterval = 500;
      const maxPolls = 1200;
      let pollCount = 0;

      while (pollCount < maxPolls && shouldPollRef.current) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        pollCount++;

        if (!shouldPollRef.current) break;

        try {
          const status = await pollImportProgress(jobId);
          if (!shouldPollRef.current) break;

          setImportProgress(status);

          if (status.isComplete) {
            if (!status.error && status.result?.importedCount && status.result.importedCount > 0) {
              onImportComplete();
            }
            break;
          }
        } catch (pollError) {
          console.error('Poll error:', pollError);
        }
      }

      if (pollCount >= maxPolls) {
        setImportProgress(prev => prev ? {
          ...prev,
          stage: ImportStages.Failed,
          message: 'Import timed out. Check server logs.',
          isComplete: true,
          error: 'Import timed out after 10 minutes'
        } : null);
      }
    } catch (err) {
      setImportProgress(prev => prev ? {
        ...prev,
        stage: ImportStages.Failed,
        message: err instanceof Error ? err.message : 'Unknown error',
        isComplete: true,
        error: err instanceof Error ? err.message : 'Unknown error'
      } : null);
    } finally {
      setImporting(null);
    }
  };

  const closeProgressModal = () => {
    shouldPollRef.current = false;
    setImportProgress(null);
    setCancelling(false);
  };

  const handleCancelImport = async () => {
    if (!importProgress?.jobId) return;

    setCancelling(true);
    try {
      await mastService.cancelImport(importProgress.jobId);
    } catch (err) {
      console.error('Cancel error:', err);
    }
  };

  return (
    <div className="whats-new-panel">
      <div className="whats-new-header">
        <h2>What's New on MAST</h2>
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <p className="whats-new-description">
        Browse JWST observations recently released to the public
      </p>

      <div className="whats-new-filters">
        <div className="filter-group">
          <label>Time Period</label>
          <div className="filter-buttons">
            {([7, 30, 90] as DaysOption[]).map(days => (
              <button
                key={days}
                className={`filter-btn ${daysBack === days ? 'active' : ''}`}
                onClick={() => setDaysBack(days)}
              >
                Last {days} days
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label>Instrument</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="instrument-select"
          >
            <option value="">All Instruments</option>
            {INSTRUMENTS.map(inst => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {results.length > 0 && (
        <div className="results-count">
          {results.length} observation{results.length !== 1 ? 's' : ''} found
        </div>
      )}

      <div className="observation-cards">
        {results.map((obs, index) => {
          const obsId = obs.obs_id || `obs-${index}`;
          const showThumbnail = obs.jpegURL && !failedThumbnails.has(obsId);

          return (
            <div key={obsId} className="observation-card">
              <div className="card-thumbnail">
                {showThumbnail ? (
                  <img
                    src={obs.jpegURL}
                    alt={obs.target_name || 'JWST Observation'}
                    onError={() => handleThumbnailError(obsId)}
                    loading="lazy"
                  />
                ) : (
                  <div className="thumbnail-placeholder">
                    <span className="telescope-icon">&#128301;</span>
                  </div>
                )}
              </div>

              <div className="card-content">
                <h4 className="card-target" title={obs.target_name || obsId}>
                  {obs.target_name || 'Unknown Target'}
                </h4>

                <div className="card-details">
                  <span className="detail-item instrument">
                    {obs.instrument_name || '-'}
                  </span>
                  <span className="detail-item filter" title={obs.filters}>
                    {obs.filters || '-'}
                  </span>
                  <span className="detail-item exptime">
                    {formatExposureTime(obs.t_exptime)}
                  </span>
                </div>

                <div className="card-date">
                  Released: {formatMjdDate(obs.t_obs_release)}
                </div>
              </div>

              <button
                className="card-import-btn"
                onClick={() => obs.obs_id && handleImport(obs.obs_id)}
                disabled={importing === obs.obs_id || !obs.obs_id}
              >
                {importing === obs.obs_id ? 'Importing...' : 'Import'}
              </button>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="load-more-container">
          <button
            className="load-more-btn"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
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
                className={`progress-bar-fill ${importProgress.stage === ImportStages.Complete ? 'complete' :
                  importProgress.stage === ImportStages.Failed ? 'failed' : ''
                  }`}
                style={{ width: `${importProgress.downloadProgressPercent ?? importProgress.progress}%` }}
              />
            </div>

            <p className="import-progress-stage">
              {!importProgress.isComplete && <span className="spinner" />}
              {(importProgress.stage === ImportStages.Downloading && importProgress.totalBytes && importProgress.totalBytes > 0)
                ? 'Downloading...'
                : importProgress.message}
            </p>

            {/* Byte-level progress details */}
            {importProgress.totalBytes !== undefined && importProgress.totalBytes > 0 && (
              <div className="download-details">
                <span className="download-bytes">
                  {formatBytes(importProgress.downloadedBytes ?? 0)} / {formatBytes(importProgress.totalBytes)}
                </span>
                {importProgress.speedBytesPerSec !== undefined && importProgress.speedBytesPerSec > 0 && (
                  <span className="download-speed">
                    {formatBytes(importProgress.speedBytesPerSec)}/s
                  </span>
                )}
                {importProgress.etaSeconds !== undefined && importProgress.etaSeconds > 0 && (
                  <span className="download-eta">
                    ETA: {formatEta(importProgress.etaSeconds)}
                  </span>
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
                      {fp.status === 'complete' ? '\u2713' :
                        fp.status === 'downloading' ? `${(fp.progressPercent ?? 0).toFixed(0)}%` :
                          fp.status === 'failed' ? '\u2717' :
                            fp.status === 'paused' ? '\u23F8' : '\u25CB'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="import-progress-obs-id">
              Observation: {importProgress.obsId}
            </p>

            {importProgress.error && (
              <div className="import-progress-error">
                {importProgress.error}
                {importProgress.isResumable && importProgress.downloadedBytes != null && importProgress.totalBytes != null && (
                  <p className="import-progress-resumable">
                    Download can be resumed from {formatBytes(importProgress.downloadedBytes)} of {formatBytes(importProgress.totalBytes)}.
                  </p>
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
              {importProgress.error && !importProgress.isResumable && (
                <button
                  className="import-retry-btn"
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

export default WhatsNewPanel;
