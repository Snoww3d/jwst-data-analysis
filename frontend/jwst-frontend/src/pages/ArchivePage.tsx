import { useEffect } from 'react';
import MastSearch from '../components/mast/MastSearch';
import WhatsNewPanel from '../components/WhatsNewPanel';
import './ArchivePage.css';

/**
 * Archive search page — public MAST search + "What's New on MAST" browsing.
 *
 * Extracted from the library dashboard (#1617): MAST is now a standalone
 * acquisition surface reachable from anywhere (Discover CTA, library
 * toolbar link) rather than a toggle panel gated behind /library.
 * Anonymous visitors can search; importing requires login (gated inside
 * MastSearch/ResultsTable).
 */
export function ArchivePage() {
  useEffect(() => {
    document.title = 'Archive Search — JWST Discovery';
  }, []);

  return (
    <div className="archive-page">
      <div className="archive-page-header">
        <h1 className="archive-title">Archive search</h1>
        <p className="archive-subtitle">
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
