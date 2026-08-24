import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MastObservationResult, MastSearchType } from '../../types/MastTypes';
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
import { EmptyState } from '../ui/EmptyState';
import { toast } from '../ui/toast';
import { SplitView } from '../ui/SplitView';
import WhatsNewPanel from '../WhatsNewPanel';
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
import { useCoverage } from './hooks/useCoverage';
import { loadVisibleColumns, saveVisibleColumns } from './resultColumns';
import { parseSortParam, toSortParam } from './resultSort';
import { footprintCentroid, parseStcs } from './map/footprints';
import { regionTooLarge, type SkyRegion } from '../../utils/skyGeometry';
import { ang2pixNest } from './map/healpix';
import type { SkyMapHandle, SkyView } from './map/SkyMap';
import './MastSearch.css';

// The map pulls the Aladin bundle at runtime; keep its React code out of
// the main chunk too so the table-only path never pays for it.
const SkyMap = React.lazy(() => import('./map/SkyMap'));

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
/** Radius for a search started by clicking a footprint on the map. */
const FOOTPRINT_CLICK_RADIUS = '0.2';
/** Radius for a search started by clicking a coverage cell (~0.9° across). */
const COVERAGE_CLICK_RADIUS = '0.6';
/** FOV after picking a What's New row on the empty-state map. */
const WHATS_NEW_FOCUS_FOV = 0.5;

function includesAllLevels(levels: readonly number[]): boolean {
  return CALIB_LEVELS.every((l) => levels.includes(l));
}

/** `"151.7531 -40.4407"` — what the smart input parses as coordinates. */
function positionQuery(ra: number, dec: number): string {
  return `${ra.toFixed(4)} ${dec.toFixed(4)}`;
}

const MapFallback: React.FC = () => (
  <div className="sky-map-placeholder" role="status">
    Loading sky map…
  </div>
);

/**
 * MAST Portal search page: composes the URL state, the search hook, the
 * import hook, library availability, the smart input, the filter rail, the
 * results toolbar + table, the sky map (split view), the browse-first empty
 * state, the resumable-downloads panel and the import progress overlays.
 * The behaviour lives in the hooks (MAST Search v2 Phase 3); the rail and
 * query-less faceting arrived with Phase 4; the sky map and the empty state
 * with Phase 5.
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

  // Row ↔ footprint linkage (Phase 5): the row under the pointer (either
  // side) and the row the map last clicked. Page state, no context.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusedObs, setFocusedObs] = useState<{ of: SearchOutcome | null; id: string | null }>({
    of: null,
    id: null,
  });
  const focusedId = focusedObs.of === outcome ? focusedObs.id : null;
  const mapRef = useRef<SkyMapHandle>(null);
  const view = url.view ?? 'table';

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
  const { sort: urlSort, view: urlView, push: urlPush } = url;
  const nextUrlState = useCallback(
    (q: string, r: string, facets: FacetState, region?: SkyRegion): SearchUrlState => ({
      q,
      r,
      allLevels: includesAllLevels(facets.calibLevels),
      facets,
      region,
      sort: urlSort,
      view: urlView,
    }),
    [urlSort, urlView]
  );

  /** Submit from the input or the rail: validate, then push the URL — the
   *  effect below runs the search, so Back/Forward and deep links share one path. */
  const handleSubmit = (rawQuery: string, rawRadius: string, facets: FacetState = draft) => {
    const q = rawQuery.trim();
    // A typed query replaces a drawn region; adjusting facets keeps it.
    const region = q ? undefined : url.region;
    if (!q && !region && !hasNarrowingFacets(facets)) {
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
    url.push(nextUrlState(q, rawRadius, next, region));
  };

  /** Removing an applied chip applies at once — it is one deliberate click. */
  const handleRemoveChip = (key: string) => {
    const next = removeFacetChip(appliedFacets, key);
    setDraft(next);
    url.push(nextUrlState(url.q, url.r, next, url.region));
  };

  const handleClear = () => {
    setDraft(EMPTY_FACETS);
    setFormError(null);
    if (!facetsEqual(appliedFacets, EMPTY_FACETS)) {
      url.push(nextUrlState(url.q, url.r, EMPTY_FACETS, url.region));
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
  const {
    q: urlQ,
    r: urlR,
    facets: urlFacets,
    region: urlRegion,
    navKey,
    searchKey,
    hasSearch,
  } = url;
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
    lastRunTypeRef.current = parsed
      ? SEARCH_TYPE_FOR_KIND[parsed.kind]
      : urlRegion
        ? 'coordinates'
        : 'facets';
    void run(parsed, {
      radius: parseFloat(urlR),
      includeRaw: false,
      calibLevels: facets.calibLevels,
      filters: buildCriteria(facets),
      // a date facet bounds a facet-only query already; the window is for bare facets
      daysBack: parsed || urlRegion || hasDateFacet(facets) ? undefined : facets.daysBack,
      region: parsed ? undefined : urlRegion,
      historyKey: searchKey,
    });
    return forget;
  }, [navKey, urlQ, urlR, urlFacets, urlRegion, hasSearch, searchKey, run, reset]);

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

  /** Map click on a result footprint: focus the row (highlight + scroll). */
  const handleMapClick = useCallback(
    (obsId: string) => {
      setFocusedObs({ of: outcome, id: obsId });
      const row = document.getElementById(`obs-${obsId}`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [outcome]
  );

  // ---- Draw-to-search (Phase 6) ------------------------------------------
  /** A drawn shape becomes the search: `region=` replaces `q` in the URL. */
  const handleRegionDrawn = useCallback(
    (region: SkyRegion) => {
      if (regionTooLarge(region)) {
        toast.warning('Draw a smaller region', {
          description: 'Regions are limited to about 20 degrees across.',
          duration: 5000,
        });
        return;
      }
      setFormError(null);
      urlPush(nextUrlState('', url.r, draft, region));
    },
    [urlPush, nextUrlState, url.r, draft]
  );

  /** Removing the region chip clears it and runs nothing new. */
  const handleRegionClear = useCallback(() => {
    urlPush(nextUrlState(url.q, url.r, appliedFacets));
  }, [urlPush, nextUrlState, url.q, url.r, appliedFacets]);

  // ---- Browse-first empty state (no query, no narrowing facets) ----------
  const browsing = !hasSearch;
  const coverage = useCoverage(browsing);
  const [whatsNewRows, setWhatsNewRows] = useState<MastObservationResult[]>([]);
  const [browseSelected, setBrowseSelected] = useState<string | null>(null);
  const browseSelectedIds = useMemo(
    () => (browseSelected ? new Set([browseSelected]) : EMPTY_SELECTION),
    [browseSelected]
  );
  const coverageCells = useMemo(() => {
    const grid = coverage.grid;
    if (!grid) return null;
    return { nside: grid.nside, cells: new Set(grid.cells.map(([pix]) => pix)) };
  }, [coverage.grid]);
  /** What's New rows + the real footprints of the zoomed-in region, by obs_id. */
  const browseRows = useMemo(() => {
    const byId = new Map<string, MastObservationResult>();
    for (const r of whatsNewRows) if (r.obs_id) byId.set(r.obs_id, r);
    for (const r of coverage.region?.rows ?? [])
      if (r.obs_id && !byId.has(r.obs_id)) byId.set(r.obs_id, r);
    return Array.from(byId.values());
  }, [whatsNewRows, coverage.region]);

  /** Any click on a browse footprint → the normal coordinate search there. */
  const searchAtFootprint = useCallback(
    (obsId: string) => {
      const row = browseRows.find((r) => r.obs_id === obsId);
      const centre = footprintCentroid(parseStcs(row?.s_region));
      if (!centre) return;
      setFormError(null);
      urlPush(nextUrlState(positionQuery(centre.ra, centre.dec), FOOTPRINT_CLICK_RADIUS, draft));
    },
    [browseRows, urlPush, nextUrlState, draft]
  );

  /** A click on empty sky: search there if JWST has coverage in that cell. */
  const searchAtSky = useCallback(
    (pos: { ra: number; dec: number }) => {
      if (!coverageCells) return;
      const v = mapRef.current?.getView();
      // zoomed in, real footprints are clickable themselves — ignore blank sky
      if (v && v.fov < 10) return;
      if (!coverageCells.cells.has(ang2pixNest(coverageCells.nside, pos.ra, pos.dec))) return;
      setFormError(null);
      urlPush(nextUrlState(positionQuery(pos.ra, pos.dec), COVERAGE_CLICK_RADIUS, draft));
    },
    [coverageCells, urlPush, nextUrlState, draft]
  );

  const handleWhatsNewSelect = useCallback((obs: MastObservationResult) => {
    if (!obs.obs_id) return;
    setBrowseSelected(obs.obs_id);
    const centre = footprintCentroid(parseStcs(obs.s_region));
    if (centre) mapRef.current?.goto(centre.ra, centre.dec, WHATS_NEW_FOCUS_FOV);
  }, []);

  const handleBrowseViewChange = useCallback(
    (v: SkyView) => {
      void coverage.loadRegion(v);
    },
    [coverage]
  );

  const coverageNotice =
    coverage.status === 'loading' || coverage.status === 'building'
      ? 'Loading JWST coverage…'
      : coverage.status === 'error'
        ? 'JWST coverage unavailable right now.'
        : coverage.grid?.stale
          ? 'Coverage snapshot is more than a day old.'
          : coverage.region?.truncated
            ? 'Showing the newest footprints in view — zoom in for the rest.'
            : null;

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
        recentsPlacement={browsing ? 'above' : 'below'}
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
          url.replace(nextUrlState(urlQ, urlR, withRaw, urlRegion));
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

          {browsing && (
            <section className="mast-browse" aria-label="Explore JWST observations">
              <EmptyState
                bare
                size="compact"
                title="Explore the JWST sky"
                description="Pan the sky, pick a recent release, or type a target."
              />
              <SplitView
                storageKey="mast-browse"
                label="Resize What's New and the sky map"
                primary={
                  <WhatsNewPanel
                    compact
                    selectedObsId={browseSelected}
                    onSelect={handleWhatsNewSelect}
                    onResultsChange={setWhatsNewRows}
                  />
                }
                secondary={
                  <Suspense fallback={<MapFallback />}>
                    <SkyMap
                      ref={mapRef}
                      rows={browseRows}
                      selectedIds={browseSelectedIds}
                      hoverId={hoverId}
                      coverage={coverage.grid}
                      autoFit={false}
                      onHover={setHoverId}
                      onClick={searchAtFootprint}
                      onSkyClick={searchAtSky}
                      onViewChange={handleBrowseViewChange}
                      notice={coverageNotice}
                      onRegionDrawn={handleRegionDrawn}
                    />
                  </Suspense>
                }
              />
            </section>
          )}

          {outcome && (outcome.count > 0 || outcome.region) && (
            <>
              <ResultsToolbar
                count={outcome.count}
                truncated={outcome.truncated}
                pageSize={outcome.pageSize}
                region={outcome.region}
                unclippable={outcome.unclippable}
                onRegionClear={handleRegionClear}
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
                view={view}
                onViewChange={url.setView}
                onFitMap={() => mapRef.current?.fitToResults()}
              />
              <SplitView
                storageKey="mast-search"
                collapsed={view !== 'split'}
                label="Resize results and the sky map"
                primary={
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
                    highlightedObs={hoverId ?? focusedId}
                    onRowHover={setHoverId}
                  />
                }
                secondary={
                  <Suspense fallback={<MapFallback />}>
                    <SkyMap
                      ref={mapRef}
                      rows={rows}
                      hoverId={hoverId}
                      selectedIds={focusedId ? new Set([...selectedObs, focusedId]) : selectedObs}
                      onHover={setHoverId}
                      onClick={handleMapClick}
                      region={url.region ?? null}
                      onRegionDrawn={handleRegionDrawn}
                      onRegionClear={handleRegionClear}
                    />
                  </Suspense>
                }
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
