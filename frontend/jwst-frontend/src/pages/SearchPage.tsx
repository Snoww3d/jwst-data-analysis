import { useEffect } from 'react';
import MastSearch from '../components/mast/MastSearch';
import WhatsNewPanel from '../components/WhatsNewPanel';
import './SearchPage.css';

/**
 * Search page — public MAST search + "What's New on MAST" browsing.
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

      {/*
        WhatsNewPanel no longer takes an onImportComplete callback —
        `useActiveImports` (the global header pill's hook) is the single
        source of import-completion toasts, with last-job-in-batch
        aggregation so bulk imports don't spam one toast per job. See
        useActiveImports.ts.
      */}
      <WhatsNewPanel />
    </div>
  );
}
