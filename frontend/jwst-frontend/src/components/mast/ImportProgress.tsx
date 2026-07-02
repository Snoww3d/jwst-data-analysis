import React from 'react';
import {
  ImportJobStatus,
  ImportStages,
  FileProgressInfo,
  BulkImportStatus,
} from '../../types/MastTypes';
import type { DownloadSource } from '../../services';
import {
  formatBytes,
  formatEta,
  getCommonPrefix,
  groupFilesBySuffix,
  summariseGroup,
} from './fileProgressUtils';
import './ImportProgress.css';

interface ImportProgressProps {
  importProgress: ImportJobStatus | null;
  downloadSource: DownloadSource;
  cancelling: boolean;
  expandedFileGroups: Set<string>;
  onToggleFileGroup: (groupKey: string) => void;
  onCancel: () => void;
  onClose: () => void;
  onResume: (jobId: string, obsId: string) => void;
  onRetry: (obsId: string) => void;
  bulkImportStatus: BulkImportStatus | null;
  onCloseBulk: () => void;
}

/**
 * Import progress overlays: the single-import modal (with byte/file-level
 * progress tree) and the bulk-import modal (multi-job aggregate).
 *
 * Relocated from MastSearch.tsx (#1617) — behavior preserved verbatim.
 */
const ImportProgress: React.FC<ImportProgressProps> = ({
  importProgress,
  downloadSource,
  cancelling,
  expandedFileGroups,
  onToggleFileGroup,
  onCancel,
  onClose,
  onResume,
  onRetry,
  bulkImportStatus,
  onCloseBulk,
}) => {
  return (
    <>
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
                  <div className="file-progress-list scroll-shadow">
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
                      const nestChar = isLastGroup ? ' ' : '│';

                      if (group.subPrefix && group.items.length > 1) {
                        const groupKey = group.subPrefix;
                        const isExpanded = expandedFileGroups.has(groupKey);

                        return (
                          <React.Fragment key={group.subPrefix}>
                            <div
                              className="file-tree-subgroup"
                              onClick={() => onToggleFileGroup(groupKey)}
                            >
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

            <p className="import-progress-obs-id">
              Observation: {importProgress.obsId}
              {importProgress.stage === ImportStages.Downloading && (
                <span className="download-source-badge">
                  {downloadSource === 'auto'
                    ? ' (Auto: S3/HTTP)'
                    : downloadSource === 's3'
                      ? ' (S3 Direct)'
                      : ' (HTTP)'}
                </span>
              )}
            </p>

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
                  className="btn-base btn-large import-cancel-btn"
                  onClick={onCancel}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Import'}
                </button>
              )}
              {importProgress.isComplete && (
                <button className="btn-base btn-large import-progress-close" onClick={onClose}>
                  Close
                </button>
              )}
              {importProgress.isResumable && importProgress.error && importProgress.jobId && (
                <button
                  className="btn-base btn-large import-resume-btn"
                  onClick={() => {
                    if (importProgress.jobId && importProgress.obsId) {
                      onResume(importProgress.jobId, importProgress.obsId);
                    }
                  }}
                >
                  Resume Download
                </button>
              )}
              {importProgress.error && !importProgress.isResumable && (
                <button
                  className="btn-base btn-large import-resume-btn"
                  onClick={() => {
                    onClose();
                    if (importProgress.obsId) {
                      onRetry(importProgress.obsId);
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
            <div className="bulk-jobs-list scroll-shadow">
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
                <button className="btn-base btn-large import-progress-close" onClick={onCloseBulk}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ImportProgress;
