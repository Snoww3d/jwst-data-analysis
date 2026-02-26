import { useParams, Link } from 'react-router-dom';
import './TargetDetail.css';

/**
 * Target detail page — shows available observations and suggested composites.
 * Placeholder shell — content implemented in Phase C (task #8).
 */
export function TargetDetail() {
  const { name } = useParams<{ name: string }>();
  const displayName = name ? decodeURIComponent(name) : 'Unknown Target';

  return (
    <div className="target-detail">
      <div className="target-detail-back">
        <Link to="/" className="back-link">
          &larr; Back to Discovery
        </Link>
      </div>
      <h2>{displayName}</h2>
      <p className="target-detail-placeholder">
        Suggested composites and available observations for this target will appear here.
      </p>
    </div>
  );
}
