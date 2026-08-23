import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import JwstDataDashboard from '../components/JwstDataDashboard';
import { SemanticSearchPanel } from '../components/library/SemanticSearchPanel';
import { jwstDataService, ApiError } from '../services';
import { JwstDataModel } from '../types/JwstDataTypes';
import { CE_MODE } from '../config/ce';
import './MyLibrary.css';

type LibraryTab = 'library' | 'search';

/**
 * My Library page — wraps the existing JwstDataDashboard at /library.
 * Data fetching that previously lived in MainApp now lives here so it
 * only runs when this route is active.
 *
 * Non-CE adds a second tab, "Search library" (#1618): semantic search over
 * the local library, formerly the standalone /search page. The active tab is
 * kept in the URL (`?tab=search`) so it is deep-linkable. CE renders no tab
 * strip — the semantic API never mounts there.
 */
export function MyLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: LibraryTab =
    !CE_MODE && searchParams.get('tab') === 'search' ? 'search' : 'library';

  const selectTab = (tab: LibraryTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'search') next.set('tab', 'search');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const [data, setData] = useState<JwstDataModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const result = await jwstDataService.getAll(true);
      setData(result);
      setError(null);
    } catch (err) {
      if (ApiError.isApiError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    try {
      const result = await jwstDataService.getAll(true);
      setData(result);
      setError(null);
    } catch {
      // Silent failure on background refresh — data stays as-is
    }
  };

  useEffect(() => {
    document.title = CE_MODE ? 'Library — JWST Discovery' : 'My Library — JWST Discovery';
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // Loading/error only gate the Library tab — the search tab needs no
  // library fetch, so a `?tab=search` deep link renders immediately.
  let libraryContent;
  if (loading) {
    libraryContent = (
      <div className="library-loading">
        <h2>Loading Library...</h2>
        <div className="spinner"></div>
      </div>
    );
  } else if (error) {
    libraryContent = (
      <div className="library-error">
        <h2>Error</h2>
        <p>{error}</p>
        <button className="btn-base" onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  } else {
    libraryContent = <JwstDataDashboard data={data} onDataUpdate={refreshData} />;
  }

  return (
    <div className="my-library">
      <div className="library-header">
        <h1 className="library-title">{CE_MODE ? 'Library' : 'My Library'}</h1>
        <p className="library-subtitle">
          {CE_MODE
            ? 'Browse the curated JWST data behind the featured targets'
            : 'Your imported FITS files, composites, and mosaics'}
        </p>
      </div>
      {!CE_MODE && (
        <div className="library-tabs" role="tablist" aria-label="Library views">
          <button
            type="button"
            role="tab"
            id="library-tab-library"
            aria-selected={activeTab === 'library'}
            aria-controls="library-panel-library"
            className={`library-tab ${activeTab === 'library' ? 'library-tab-active' : ''}`}
            onClick={() => selectTab('library')}
          >
            Library
          </button>
          <button
            type="button"
            role="tab"
            id="library-tab-search"
            aria-selected={activeTab === 'search'}
            aria-controls="library-panel-search"
            className={`library-tab ${activeTab === 'search' ? 'library-tab-active' : ''}`}
            onClick={() => selectTab('search')}
          >
            Search library
          </button>
        </div>
      )}
      {activeTab === 'library' ? (
        <div role="tabpanel" id="library-panel-library" aria-labelledby="library-tab-library">
          {libraryContent}
        </div>
      ) : (
        <div role="tabpanel" id="library-panel-search" aria-labelledby="library-tab-search">
          <SemanticSearchPanel />
        </div>
      )}
    </div>
  );
}
