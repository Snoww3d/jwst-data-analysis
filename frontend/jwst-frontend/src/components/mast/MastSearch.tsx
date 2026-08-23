import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MastSearchType } from '../../types/MastTypes';
import { useAuth } from '../../context/useAuth';
import { useSearchUrlState, type SearchUrlState } from '../../hooks/useSearchUrlState';
import { parseSearchQuery } from '../../utils/searchQueryParser';
import {
  CALIB_LEVELS,
  DEFAULT_CALIB_LEVELS,
  EMPTY_FACETS,
  buildCriteria,
  describeFacets,
  facetsEqual,
  hasDateFacet,
  hasNarrowingFacets,
  removeFacetChip,
  type FacetState,
} from '../../utils/mastCriteria';
import {
  loadRecentSearches,
  recordRecentSearch,
  type RecentSearch,
} from '../../utils/recentSearches';
import SmartSearchInput from './SmartSearchInput';
import FilterRail from './FilterRail';
import ActiveFilterChips from './ActiveFilterChips';
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

function includesAllLevels(levels: readonly number[]): boolean {
  return CALIB_LEVELS.every((l) => levels.includes(l));
}

/**
 * MAST Portal search page: composes the URL state, the search hook, the
 * import hook, library availability, the smart input, the filter rail, the
 * results toolbar + table, the resumable-downloads panel and the import
 * progress overlays. The behaviour lives in the hooks (MAST Search v2
 * Phase 3); the rail and query-less faceting arrived with Phase 4.
 */
const MastSearch: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const url = useSearchUrlState();
  const { outcome, status, error: searchError, run, reset } = useMastSearch();
  const loading = status === 'loading';

  const [query, setQuery] = useState(url.q);
  const [radius, setRadius] = useState(url.r);
  // The rail edits a DRAFT of the facets; Apply / Search pushes it to the URL.
  // Calibration levels live here too — the input's "include raw" toggle is a
  // shortcut for levels 1–3 vs 3.
  const appliedFacets = url.facets ?? EMPTY_FACETS;
  const [draft, setDraft] = useState<FacetState>(appliedFacets);
  const showAllCalibLevels = includesAllLevels(draft.calibLevels);
  // #1766: the raw-fallback offer flips the toggle on the user's behalf. Track
  // that so a later search of a different kind doesn't inherit it silently.
  const offerForcedLevelsRef = useRef(false);
  // The kind of the last search that RAN (#1766 keys off it); the text box
  // itself may hold something else while the user types.
  const lastRunTypeRef = useRef<MastSearchType>('target');
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
    // Observation-ID results span every level; otherwise mirror the applied levels.
    calibLevel: outcome?.searchType === 'observation' ? undefined : appliedFacets.calibLevels,
  });

  const parsedInput = useMemo(() => parseSearchQuery(query.trim()), [query]);
  const idLookup =
    Boolean(query.trim()) && (parsedInput.kind === 'obsId' || parsedInput.kind === 'program');

  /** The URL state for a submit: the typed query + radius + the draft facets. */
  const nextUrlState = (q: string, r: string, facets: FacetState): SearchUrlState => ({
    q,
    r,
    allLevels: includesAllLevels(facets.calibLevels),
    facets,
    sort: url.sort,
    view: url.view,
  });

  /** Submit from the input or the rail: validate, then push the URL — the
   *  effect below runs the search, so Back/Forward and deep links share one path. */
  const handleSubmit = (rawQuery: string, rawRadius: string, facets: FacetState = draft) => {
    const q = rawQuery.trim();
    if (!q && !hasNarrowingFacets(facets)) {
      setFormError(
        'Enter a target name, coordinates, an observation ID, or a program ID — or pick filters and apply them'
      );
      return;
    }
    const kind = q ? parseSearchQuery(q).kind : null;
    if (kind === 'target' || kind === 'coords') {
      const r = parseFloat(rawRadius);
      if (!Number.isFinite(r) || r < 0.01 || r > 10) {
        setFormError('Radius must be between 0.01 and 10 degrees');
        return;
      }
    }
    let next = facets;
    // #1766: the offer turned raw levels on for ONE search. Carrying that into
    // a different kind of search silently returns L1/L2 results where the UI
    // implies L3-only.
    const nextType: MastSearchType = kind ? SEARCH_TYPE_FOR_KIND[kind] : 'facets';
    if (offerForcedLevelsRef.current && nextType !== lastRunTypeRef.current) {
      next = { ...facets, calibLevels: [...DEFAULT_CALIB_LEVELS] };
      setDraft(next);
      offerForcedLevelsRef.current = false;
    }
    setFormError(null);
    url.push(nextUrlState(q, rawRadius, next));
  };

  /** Removing an applied chip applies at once — it is one deliberate click. */
  const handleRemoveChip = (key: string) => {
    const next = removeFacetChip(appliedFacets, key);
    setDraft(next);
    url.push(nextUrlState(url.q, url.r, next));
  };

  const handleClear = () => {
    setDraft(EMPTY_FACETS);
    setFormError(null);
    if (!facetsEqual(appliedFacets, EMPTY_FACETS)) {
      url.push(nextUrlState(url.q, url.r, EMPTY_FACETS));
    }
  };

  // The URL drives the search. `navKey` changes on every navigation — submit,
  // Back/Forward, the raw-data offer's replace, a sort change, a deep link —
  // and the hook's history cache (keyed on `searchKey`) makes runs that don't
  // change the search itself restore the last result set without a query.
  // The guard ref keeps one navigation to one run; its cleanup forgets the
  // key because under StrictMode (dev) the first mount's effect is cleaned
  // up — which aborts the in-flight search — and run again: without the
  // forget, the second run would skip and a deep link would show nothing.
  const lastRunNavKeyRef = useRef<string | null>(null);
  const { q: urlQ, r: urlR, facets: urlFacets, navKey, searchKey, hasSearch } = url;
  useEffect(() => {
    if (lastRunNavKeyRef.current === navKey) return;
    lastRunNavKeyRef.current = navKey;
    const forget = () => {
      lastRunNavKeyRef.current = null;
    };
    const facets = urlFacets ?? EMPTY_FACETS;
    // No query + narrowing facets = a facet-only search (parsed === null).
    const parsed = urlQ ? parseSearchQuery(urlQ) : null;
    // Only real queries are worth remembering; facet-only searches live in the URL.
    const remembered = hasSearch && urlQ ? recordRecentSearch({ q: urlQ, r: urlR }) : null;
    setQuery(urlQ);
    setRadius(urlR);
    setDraft(facets);
    setFormError(null);
    setRecents((prev) => remembered ?? prev);
    if (!hasSearch) {
      // Back to a URL that is not a search (e.g. the last chip was removed):
      // the results on screen would describe a search that no longer exists.
      reset();
      return forget;
    }
    lastRunTypeRef.current = parsed ? SEARCH_TYPE_FOR_KIND[parsed.kind] : 'facets';
    void run(parsed, {
      radius: parseFloat(urlR),
      includeRaw: false,
      calibLevels: facets.calibLevels,
      filters: buildCriteria(facets),
      // a date facet bounds a facet-only query already; the window is for bare facets
      daysBack: parsed || hasDateFacet(facets) ? undefined : facets.daysBack,
      historyKey: searchKey,
    });
    return forget;
  }, [navKey, urlQ, urlR, urlFacets, hasSearch, searchKey, run, reset]);

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

  const chips = useMemo(
    () =>
      describeFacets(appliedFacets, {
        showWindow: !url.q && hasSearch,
        defaultWindowApplied: Boolean(outcome?.defaultWindowApplied),
      }),
    [appliedFacets, url.q, hasSearch, outcome]
  );

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
          setDraft({ ...draft, calibLevels: v ? [...CALIB_LEVELS] : [...DEFAULT_CALIB_LEVELS] });
        }}
        loading={loading}
        recents={recents}
        onSubmit={(q, r) => handleSubmit(q, r)}
      />

      {error && <div className="error-message">{error}</div>}

      <RawFallbackPanel
        offer={rawOffer}
        loading={loading}
        onAccept={() => {
          offerForcedLevelsRef.current = true;
          const withRaw = { ...appliedFacets, calibLevels: [...CALIB_LEVELS] };
          setDraft(withRaw);
          // Replace (not push) so Back skips the L3-only variant of the same
          // search; the URL effect re-runs with every level.
          url.replace(nextUrlState(urlQ, urlR, withRaw));
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

      <div className="mast-search-body">
        <FilterRail
          value={draft}
          onChange={setDraft}
          onApply={() => handleSubmit(query, radius, draft)}
          onClear={handleClear}
          applied={appliedFacets}
          loading={loading}
          idLookup={idLookup}
        />

        <div className="mast-search-results">
          <ActiveFilterChips chips={chips} onRemove={handleRemoveChip} disabled={loading} />

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
        </div>
      </div>

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
