import React, { useState } from 'react';
import type { ResumableJobSummary } from '../../types/MastTypes';

interface ResumableDownloadsPanelProps {
  jobs: ResumableJobSummary[];
  /** Disables Resume while another import is running. */
  busy: boolean;
  onResume: (job: ResumableJobSummary) => void;
  onDismiss: (job: ResumableJobSummary) => void;
}

/**
 * "Incomplete Downloads" — resumable import jobs from GET
 * /api/mast/import/resumable. Collapsed by default. Authenticated only; the
 * caller does not render it otherwise. Styles live in MastSearch.css.
 */
const ResumableDownloadsPanel: React.FC<ResumableDownloadsPanelProps> = ({
  jobs,
  busy,
  onResume,
  onDismiss,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  if (jobs.length === 0) return null;

  return (
    <div className="resumable-section">
      <button
        type="button"
        className="resumable-header"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <h3>
          <span className={`resumable-chevron ${collapsed ? '' : 'open'}`}>{'▶'}</span> Incomplete
          Downloads ({jobs.length})
        </h3>
      </button>
      {!collapsed &&
        [...jobs]
          .sort(
            (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
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
                  onClick={() => onResume(job)}
                  disabled={busy}
                >
                  Resume
                </button>
                <button
                  className="btn-base resumable-dismiss-btn"
                  onClick={() => onDismiss(job)}
                  title="Dismiss this download"
                >
                  {'✕'}
                </button>
              </div>
            );
          })}
    </div>
  );
};

export default ResumableDownloadsPanel;
