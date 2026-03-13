import { useEffect, useRef } from 'react';
import type { ImportJobStatus, FileProgressInfo } from '../../types/MastTypes';
import './DownloadStep.css';

interface DownloadStepProps {
  targetName: string;
  /** Current job progress (null before job starts) */
  progress: ImportJobStatus | null;
  /** Error message if download failed (blocking — all failed or non-NO_PRODUCTS error) */
  error: string | null;
  /** Per-observation warnings (e.g. NO_PRODUCTS for individual filters) */
  warnings?: string[];
  /** Whether the download step is complete */
  isComplete: boolean;
  /** Retry callback */
  onRetry: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const NO_PRODUCTS_PREFIX = 'NO_PRODUCTS:';
const S3_UNAVAILABLE_PREFIX = 'S3_UNAVAILABLE:';

function isProductUnavailableError(error: string): boolean {
  return error.startsWith(NO_PRODUCTS_PREFIX) || error.startsWith(S3_UNAVAILABLE_PREFIX);
}

function getUserMessage(error: string): string {
  if (error.startsWith(NO_PRODUCTS_PREFIX)) {
    return 'No downloadable files found at MAST for this observation.';
  }
  if (error.startsWith(S3_UNAVAILABLE_PREFIX)) {
    return 'Files exist but are not available via S3 cloud download.';
  }
  return error;
}

function FileRow({ file }: { file: FileProgressInfo }) {
  const isComplete = file.status === 'complete';
  const isFailed = file.status === 'failed';
  const isDownloading = file.status === 'downloading';
  const shortName = file.filename.split('/').pop() || file.filename;

  return (
    <div
      className={`download-file-row ${isComplete ? 'file-complete' : ''} ${isFailed ? 'file-failed' : ''} ${isDownloading ? 'file-downloading' : ''}`}
    >
      <span
        className={`file-status-icon ${isComplete ? 'status-complete' : ''} ${isFailed ? 'status-failed' : ''} ${isDownloading ? 'status-downloading' : ''}`}
      >
        {isComplete && '\u2713'}
        {isFailed && '\u2717'}
        {isDownloading && '\u2193'}
        {!isComplete && !isFailed && !isDownloading && '\u2022'}
      </span>
      <span className="file-name" title={file.filename}>
        {shortName}
      </span>
      <span className="file-size">
        {file.totalBytes > 0
          ? isComplete
            ? formatBytes(file.totalBytes)
            : `${formatBytes(file.downloadedBytes)} / ${formatBytes(file.totalBytes)}`
          : isDownloading
            ? 'Starting...'
            : ''}
      </span>
      {isDownloading && file.totalBytes > 0 && (
        <div className="file-progress-bar-wrap">
          <div className="file-progress-bar" style={{ width: `${file.progressPercent}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * Step 1: Download — shows MAST import progress with per-file tracking.
 */
export function DownloadStep({
  targetName,
  progress,
  error,
  warnings = [],
  isComplete,
  onRetry,
}: DownloadStepProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show latest file progress
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [progress?.fileProgress?.length]);

  const overallPercent = progress?.progress ?? 0;
  const fileProgress = progress?.fileProgress ?? [];
  const completedFiles = fileProgress.filter((f) => f.status === 'complete').length;
  const totalFiles = fileProgress.length;

  return (
    <div className="download-step" role="status" aria-live="polite">
      <h3 className="download-step-title">
        {isComplete
          ? warnings.length > 0
            ? `${targetName} data ready (with warnings)`
            : `${targetName} data ready`
          : `Downloading ${targetName} data...`}
      </h3>

      {error && (
        <div className="download-step-error">
          <p>{getUserMessage(error)}</p>
          {isProductUnavailableError(error) ? (
            <p className="download-step-hint">
              This observation may not have downloadable science data at MAST. Pipeline mosaic
              products (c-prefix) sometimes lack hosted files.
            </p>
          ) : (
            <button className="btn-base download-step-retry" onClick={onRetry}>
              Retry Download
            </button>
          )}
          {progress?.stage && (
            <p className="download-step-last-stage">Last status: {progress.stage}</p>
          )}
        </div>
      )}

      {/* Always show progress section — not gated on !error for partial failures */}
      <div className="download-overall-bar-wrap">
        <div
          className={`download-overall-bar ${isComplete ? 'bar-complete' : ''}`}
          style={{ width: `${overallPercent}%` }}
        />
      </div>

      <p className="download-step-meta">
        {totalFiles > 0 && (
          <span>
            {completedFiles} of {totalFiles} file{totalFiles !== 1 ? 's' : ''}
          </span>
        )}
        {progress?.stage && <span className="download-step-stage">{progress.stage}</span>}
        {progress?.speedBytesPerSec != null &&
          progress.speedBytesPerSec > 0 &&
          progress.speedBytesPerSec < 10 * 1024 * 1024 * 1024 && (
            <span className="download-step-speed">{formatBytes(progress.speedBytesPerSec)}/s</span>
          )}
      </p>

      {fileProgress.length > 0 && (
        <div className="download-file-list scroll-shadow" ref={containerRef}>
          {fileProgress.map((file) => (
            <FileRow key={file.filename} file={file} />
          ))}
        </div>
      )}

      {!progress && !isComplete && !error && (
        <p className="download-step-waiting">Starting download...</p>
      )}

      {warnings.length > 0 && (
        <div className="download-step-warnings">
          {warnings.map((warning) => (
            <p key={warning} className="download-step-warning">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
