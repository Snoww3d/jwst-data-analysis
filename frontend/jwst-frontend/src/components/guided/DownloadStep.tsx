import { useEffect, useRef } from 'react';
import type { ImportJobStatus, FileProgressInfo } from '../../types/MastTypes';
import './DownloadStep.css';

interface DownloadStepProps {
  targetName: string;
  /** Current job progress (null before job starts) */
  progress: ImportJobStatus | null;
  /** Error message if download failed */
  error: string | null;
  /** Whether the download step is complete */
  isComplete: boolean;
  /** Retry callback */
  onRetry: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRow({ file }: { file: FileProgressInfo }) {
  const isComplete = file.status === 'complete';
  const isFailed = file.status === 'failed';
  const isDownloading = file.status === 'downloading';
  const shortName = file.filename.split('/').pop() || file.filename;

  return (
    <div
      className={`download-file-row ${isComplete ? 'file-complete' : ''} ${isFailed ? 'file-failed' : ''}`}
    >
      <span className="file-status-icon">
        {isComplete && '\u2713'}
        {isFailed && '\u2717'}
        {isDownloading && '\u25CF'}
        {!isComplete && !isFailed && !isDownloading && '\u25CB'}
      </span>
      <span className="file-name" title={file.filename}>
        {shortName}
      </span>
      <span className="file-size">
        {file.totalBytes > 0
          ? isComplete
            ? formatBytes(file.totalBytes)
            : `${formatBytes(file.downloadedBytes)} / ${formatBytes(file.totalBytes)}`
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
        {isComplete ? `${targetName} data ready` : `Downloading ${targetName} data...`}
      </h3>

      {error && (
        <div className="download-step-error">
          <p>{error}</p>
          <button className="download-step-retry" onClick={onRetry}>
            Retry Download
          </button>
        </div>
      )}

      {!error && (
        <>
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
            {progress?.speedBytesPerSec != null && progress.speedBytesPerSec > 0 && (
              <span className="download-step-speed">
                {formatBytes(progress.speedBytesPerSec)}/s
              </span>
            )}
          </p>

          {fileProgress.length > 0 && (
            <div className="download-file-list" ref={containerRef}>
              {fileProgress.map((file) => (
                <FileRow key={file.filename} file={file} />
              ))}
            </div>
          )}

          {!progress && !isComplete && (
            <p className="download-step-waiting">Starting download...</p>
          )}
        </>
      )}
    </div>
  );
}
