import { useSearchParams, Link } from 'react-router-dom';
import './GuidedCreate.css';

/**
 * Guided creation flow — download, process, and view composite result.
 * Placeholder shell — content implemented in Phase C (task #9).
 */
export function GuidedCreate() {
  const [searchParams] = useSearchParams();
  const target = searchParams.get('target');
  const recipe = searchParams.get('recipe');

  return (
    <div className="guided-create">
      <div className="guided-create-back">
        {target ? (
          <Link to={`/target/${encodeURIComponent(target)}`} className="back-link">
            &larr; Back to {target}
          </Link>
        ) : (
          <Link to="/" className="back-link">
            &larr; Back to Discovery
          </Link>
        )}
      </div>
      <h2>Create Composite</h2>
      {target && (
        <p className="guided-create-info">
          Target: <strong>{target}</strong>
          {recipe && (
            <>
              {' '}
              &middot; Recipe: <strong>{recipe}</strong>
            </>
          )}
        </p>
      )}
      <p className="guided-create-placeholder">
        The guided creation flow (download, process, result) will be implemented here.
      </p>
    </div>
  );
}
