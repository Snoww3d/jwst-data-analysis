import { Link } from 'react-router-dom';
import { useActiveImportsContext } from '../../context/useActiveImportsContext';
import './ImportProgressPill.css';

/**
 * Global header pill showing aggregate MAST import progress so imports
 * survive navigation away from /archive. Passive display only — cancel and
 * resume actions stay on the /archive page.
 *
 * The visible pill link renders nothing when there are no active imports
 * (anonymous users always see nothing, since `useActiveImportsContext`
 * never tracks jobs for them). The `aria-live` region, however, stays
 * mounted at all times (visually hidden when idle) — a live region that
 * only enters the DOM at the same moment its content first appears isn't
 * reliably announced by all screen readers; it needs to already exist
 * before the text changes.
 */
export function ImportProgressPill() {
  const { jobs, aggregatePercent, activeCount } = useActiveImportsContext();

  const hasJobs = jobs.length > 0;
  const allComplete = hasJobs && jobs.every((job) => job.status === 'complete');
  const label = !hasJobs
    ? ''
    : allComplete
      ? 'Import complete'
      : activeCount > 1
        ? `Importing ${activeCount} · ${aggregatePercent}%`
        : `Importing… ${aggregatePercent}%`;

  return (
    <>
      <span className="visually-hidden" aria-live="polite">
        {label}
      </span>
      {hasJobs && (
        <Link
          to="/archive"
          className={`import-progress-pill ${allComplete ? 'import-progress-success' : ''}`}
        >
          <span className="import-progress-dot" aria-hidden="true" />
          <span aria-hidden="true">{label}</span>
        </Link>
      )}
    </>
  );
}
