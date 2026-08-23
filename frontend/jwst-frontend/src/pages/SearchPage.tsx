import { useEffect } from 'react';
import MastSearch from '../components/mast/MastSearch';
import './SearchPage.css';

/**
 * Search page — public MAST search. "What's New on MAST" lives inside
 * MastSearch as the browse-first empty state (MAST Search v2 Phase 5).
 *
 * Extracted from the library dashboard (#1617) as /archive, then promoted to
 * the nav "Search" slot at /search (MAST Search v2, Phase 1; /archive
 * redirects here). Semantic search over the local library moved to a tab in
 * My Library (#1618). Reachable in CE and non-CE.
 * Anonymous visitors can search; importing requires login (gated inside
 * MastSearch/ResultsTable).
 */
export function SearchPage() {
  useEffect(() => {
    document.title = 'Search — JWST Discovery';
  }, []);

  return (
    <div className="search-page">
      <div className="search-page-header">
        <h1 className="search-page-title">Search</h1>
        <p className="search-page-subtitle">
          Search the Mikulski Archive for Space Telescopes (MAST) and import JWST observations into
          your library.
        </p>
      </div>

      <MastSearch />
    </div>
  );
}
