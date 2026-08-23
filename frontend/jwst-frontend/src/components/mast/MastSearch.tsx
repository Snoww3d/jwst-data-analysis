import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MastSearchType } from '../../types/MastTypes';
import { useAuth } from '../../context/useAuth';
import { useSearchUrlState } from '../../hooks/useSearchUrlState';
import { parseSearchQuery } from '../../utils/searchQueryParser';
import {
  loadRecentSearches,
  recordRecentSearch,
  type RecentSearch,
} from '../../utils/recentSearches';
import SmartSearchInput from './SmartSearchInput';
import { rawFallbackOffer } from './rawFallback';
import RawFallbackPanel from './RawFallbackPanel';
import ResultsToolbar from './ResultsToolbar';
import ResultsTable from './ResultsTable';
import ResumableDownloadsPanel from './ResumableDownloadsPanel';
import ImportProgress from './ImportProgress';
import { useMastSearch, SEARCH_TYPE_FOR_KIND, type SearchOutcome } from './hooks/useMastSearch';
import { useBulkImport } from './hooks/useBulkImport';
import { useLibraryAvailability } from './hooks/useLibraryAvailability';
import { loadVisibleColumns, saveVisibleColumns } from './resultColumns';
import { parseSortParam, toSortParam } from './resultSort';
import './MastSearch.css';

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * MAST Portal search page: composes the URL state, the search hook, the
 * import hook, library availability, the smart input, the results toolbar +
 * table, the resumable-downloads panel and the import progress overlays.
 * The behaviour lives in the hooks (MAST Search v2 Phase 3).
 */
const MastSearch: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const url = useSearchUrlState();
  const { outcome, status, error: searchError, run } = useMastSearch();
  const loading = status === 'loading';

  const [query, setQuery] = useState(url.q);
  const [radius, setRadius] = useState(url.r);
  const [showAllCalibLevels, setShowAllCalibLevels] = useState(url.allLevels);
  // #1766: the raw-fallback offer flips the toggle on the user's behalf. Track
  // that so a later search of a different kind doesn't inherit it silently.
  const offerForcedLevelsRef = useRef(false);
  // The kind of the last search that RAN (import logic and #1766 key off it);
  // the text box itself may hold something else while the user types.
  const [searchType, setSearchType] = useState<MastSearchType>('target');
  const [recents, setRecents] = useState<RecentSearch[]>(() => loadRecentSearches());
  const [formError, setFormError] = useState<string | null>(null);
  // Selection is tagged with the result set it belongs to, so a new result
  // set starts with nothing selected without an effect.
  const [selection, setSelection] = useState<{ of: SearchOutcome | null; ids: Set<string> }>(
    () => ({ of: null, ids: new Set() })
  );
  const selectedObs = selection.of === outcome ? selection.ids : EMPTY_SELECTION;
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => loadVisibleColumns());

  const rows = useMemo(() => outcome?.rows ?? [], [outcome]);
  const obsIds = useMemo(
    () => rows.map((r) => r.obs_id).filter((id): id is string => !!id),
    [rows]
  );
  const availability = useLibraryAvailability(obsIds);
  const imports = useBulkImport({
    isAuthenticated,
    // Observation-ID results span every level; otherwise mirror the toggle.
    calibLevel: searchType === 'observation' ? undefined : showAllCalibLevels ? [1, 2, 3] : [3],
  });

  /** Submit from the input: validate, then push the URL — the effect below
   *  runs the search, so Back/Forward and deep links share one path. */
  const handleSubmit = (rawQuery: string, rawRadius: string) => {
    const q = rawQuery.trim();
    if (!q) {
      setFormError('Enter a target name, coordinates, an observation ID, or a program ID');
      return;
    }
    const kind = parseSearchQuery(q).kind;
    if (kind === 'target' || kind === 'coords') {
      const r = parseFloat(rawRadius);
      if (!Number.isFinite(r) || r < 0.01 || r > 10) {
        setFormError('Radius must be between 0.01 and 10 degrees');
        return;
      }
    }
    let allLevels = showAllCalibLevels;
    // #1766: the offer turned raw levels on for ONE search. Carrying that into
    // a different kind of search silently returns L1/L2 results where the UI
    // implies L3-only.
    if (offerForcedLevelsRef.current && SEARCH_TYPE_FOR_KIND[kind] !== searchType) {
      allLevels = false;
      setShowAllCalibLevels(false);
      offerForcedLevelsRef.current = false;
    }
    setFormError(null);
    url.push({ q, r: rawRadius, allLevels, sort: url.sort, view: url.view });
  };

  // The URL drives the search. `navKey` changes on every navigation — submit,
  // Back/Forward, the raw-data offer's replace, a sort change, a deep link —
  // and the hook's history cache (keyed on `searchKey`) makes runs that don't
  // change the search itself restore the last result set without a query.
  const lastRunNavKeyRef = useRef<string | null>(null);
  const { q: urlQ, r: urlR, allLevels: urlAllLevels, navKey, searchKey } = url;
  useEffect(() => {
    if (!urlQ || lastRunNavKeyRef.current === navKey) return;
    lastRunNavKeyRef.current = navKey;
    setQuery(urlQ);
    setRadius(urlR);
    setShowAllCalibLevels(urlAllLevels);
    setFormError(null);
    setRecents(recordRecentSearch({ q: urlQ, r: urlR }));
    const parsed = parseSearchQuery(urlQ);
    setSearchType(SEARCH_TYPE_FOR_KIND[parsed.kind]);
    void run(parsed, {
      radius: parseFloat(urlR),
      includeRaw: urlAllLevels,
      historyKey: searchKey,
    });
  }, [navKey, urlQ, urlR, urlAllLevels, searchKey, run]);

  const rawOffer = rawFallbackOffer(
    outcome
      ? { level3Only: outcome.level3Only, resultCount: outcome.count, subject: outcome.searchType }
      : null
  );
  // With raw levels included there genuinely is nothing. Restricted to Level
  // 3, the fallback offer explains it better than an error.
  const emptyMessage =
    outcome && outcome.count === 0 && !outcome.level3Only
      ? 'No JWST observations found matching your search criteria'
      : null;
  const error = formError ?? searchError ?? emptyMessage;

  const toggleSelection = (obsId: string) => {
    const next = new Set(selectedObs);
    if (next.has(obsId)) next.delete(obsId);
    else next.add(obsId);
    setSelection({ of: outcome, ids: next });
  };

  return (
    <div className="mast-search">
      <h2>MAST Portal Search</h2>
      <p className="mast-description">
        Search the Mikulski Archive for Space Telescopes (MAST) for JWST observations
      </p>

      <SmartSearchInput
        value={query}
        onChange={setQuery}
        radius={radius}
        onRadiusChange={setRadius}
        showAllCalibLevels={showAllCalibLevels}
        onShowAllCalibLevelsChange={(v) => {
          offerForcedLevelsRef.current = false;
          setShowAllCalibLevels(v);
        }}
        loading={loading}
        recents={recents}
        onSubmit={handleSubmit}
      />

      {error && <div className="error-message">{error}</div>}

      <RawFallbackPanel
        offer={rawOffer}
        loading={loading}
        onAccept={() => {
          offerForcedLevelsRef.current = true;
          // Replace (not push) so Back skips the L3-only variant of the same
          // search; the URL effect re-runs with every level.
          url.replace({ q: urlQ, r: urlR, allLevels: true, sort: url.sort, view: url.view });
        }}
      />

      {isAuthenticated && (
        <ResumableDownloadsPanel
          jobs={imports.resumableJobs}
          busy={imports.importing !== null}
          onResume={imports.handleResumeFromPanel}
          onDismiss={imports.handleDismissDownload}
        />
      )}

      {outcome && outcome.count > 0 && (
        <>
          <ResultsToolbar
            count={outcome.count}
            truncated={outcome.truncated}
            pageSize={outcome.pageSize}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={(next) => {
              setVisibleColumns(next);
              saveVisibleColumns(next);
            }}
            selectedCount={selectedObs.size}
            onBulkImport={() => {
              void imports.handleBulkImport(Array.from(selectedObs)).then(() => {
                setSelection({ of: outcome, ids: new Set() });
              });
            }}
            importing={imports.importing !== null}
            isAuthenticated={isAuthenticated}
            availabilityStatus={availability.status}
            downloadSource={imports.downloadSource}
            onDownloadSourceChange={imports.setDownloadSource}
            view={url.view ?? 'table'}
          />
          <ResultsTable
            rows={rows}
            sort={parseSortParam(url.sort)}
            onSortChange={(next) => url.setSort(toSortParam(next))}
            visibleColumns={visibleColumns}
            selectedObs={selectedObs}
            onToggleSelection={toggleSelection}
            importing={imports.importing}
            onImport={imports.handleImport}
            isAuthenticated={isAuthenticated}
            availability={availability.byObsId}
          />
        </>
      )}

      <ImportProgress
        importProgress={imports.importProgress}
        downloadSource={imports.downloadSource}
        cancelling={imports.cancelling}
        expandedFileGroups={imports.expandedFileGroups}
        onToggleFileGroup={imports.toggleFileGroup}
        onCancel={imports.handleCancelImport}
        onClose={imports.closeProgressModal}
        onResume={imports.handleResumeImport}
        onRetry={imports.handleImport}
        bulkImportStatus={imports.bulkImportStatus}
        onCloseBulk={imports.closeBulk}
      />
    </div>
  );
};

export default MastSearch;
