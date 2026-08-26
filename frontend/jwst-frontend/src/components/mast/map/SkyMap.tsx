import type {
  AladinInstance,
  AladinStatic,
  Footprint,
  GraphicOverlay,
  Moc,
} from '../../../types/aladin-lite';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { loadAladin, AladinLoadError } from '../../../lib/loadAladin';
import { footprintBounds, footprintCentroid, fovForBounds, parseStcs } from './footprints';
import type { SkyRegion } from '../../../utils/skyGeometry';
import { cssToken, instrumentColor, withAlpha } from './instrumentColors';
import './SkyMap.css';

/** The subset of a MAST row the map needs. */
export interface FootprintRow {
  obs_id?: string;
  instrument_name?: string;
  s_region?: string;
}

/** `GET /api/mast/coverage` without `bbox` — HEALPix NESTED density cells. */
export interface CoverageGrid {
  nside: number;
  /** `[pixel, count]` pairs. */
  cells: [number, number][];
  total?: number;
  stale?: boolean;
}

export interface SkyView {
  ra: number;
  dec: number;
  /** Horizontal field of view in degrees. */
  fov: number;
}

export interface SkyMapHandle {
  setFootprints(rows: FootprintRow[]): void;
  highlight(obsId: string | null): void;
  select(ids: Iterable<string>): void;
  fitToResults(): void;
  goto(ra: number, dec: number, fov?: number): void;
  setCoverage(grid: CoverageGrid | null): void;
  getView(): SkyView | null;
}

export const SKY_SURVEYS = [
  { id: 'P/DSS2/color', label: 'DSS2 colour' },
  { id: 'P/2MASS/color', label: '2MASS' },
  { id: 'P/PanSTARRS/DR1/color-z-zg-g', label: 'PanSTARRS' },
] as const;
export type SkySurveyId = (typeof SKY_SURVEYS)[number]['id'];

/**
 * All-sky projections offered in the chrome. Aladin ships many more, but the
 * rest are tangent-plane projections that say nothing at an all-sky FOV.
 * Aitoff and Mollweide are the two every other archive UI offers; SIN is the
 * globe, kept because it reads well once zoomed into a single field.
 */
export const SKY_PROJECTIONS = [
  { id: 'AIT', label: 'Aitoff' },
  { id: 'MOL', label: 'Mollweide' },
  { id: 'SIN', label: 'Sphere' },
] as const;
export type SkyProjectionId = (typeof SKY_PROJECTIONS)[number]['id'];

export const DEFAULT_SKY_FOV = 180;
/** The browse view opens at FOV 180; a globe can only show half of that. */
export const DEFAULT_SKY_PROJECTION: SkyProjectionId = 'AIT';
export const SKY_SURVEY_STORAGE_KEY = 'mast_sky_survey';
export const SKY_PROJECTION_STORAGE_KEY = 'mast_sky_projection';
const VIEW_DEBOUNCE_MS = 250;

export interface SkyMapProps {
  /** Footprints to draw (declarative twin of `handle.setFootprints`). */
  rows?: FootprintRow[];
  /** Row under the pointer in the table (declarative twin of `handle.highlight`). */
  hoverId?: string | null;
  /** Selected rows (declarative twin of `handle.select`). */
  selectedIds?: ReadonlySet<string>;
  /** Whole-sky density layer for the empty state. */
  coverage?: CoverageGrid | null;
  /** Initial centre/FOV; after mount, use `goto`. */
  initialView?: Partial<SkyView>;
  /** Fit the view to the rows whenever they change (default true). */
  autoFit?: boolean;
  onHover?: (obsId: string | null) => void;
  onClick?: (obsId: string) => void;
  /** A click on the sky that hit no footprint. */
  onSkyClick?: (pos: { ra: number; dec: number }) => void;
  /** Debounced centre/FOV after pans and zooms. */
  onViewChange?: (view: SkyView) => void;
  /**
   * Drawn region to render persistently (draw-to-search, Phase 6). The
   * Circle/Polygon draw buttons appear when `onRegionDrawn` is given.
   */
  region?: SkyRegion | null;
  onRegionDrawn?: (region: SkyRegion) => void;
  /** Clear pressed while a region is shown. */
  onRegionClear?: () => void;
  onReady?: (handle: SkyMapHandle) => void;
  /** Message shown in the map chrome (e.g. coverage loading/stale). */
  notice?: React.ReactNode;
  className?: string;
}

function loadSurvey(): SkySurveyId {
  try {
    const stored = localStorage.getItem(SKY_SURVEY_STORAGE_KEY);
    return SKY_SURVEYS.some((s) => s.id === stored) ? (stored as SkySurveyId) : SKY_SURVEYS[0].id;
  } catch {
    return SKY_SURVEYS[0].id;
  }
}

function saveSurvey(id: SkySurveyId): void {
  try {
    localStorage.setItem(SKY_SURVEY_STORAGE_KEY, id);
  } catch {
    /* cosmetic */
  }
}

function loadProjection(): SkyProjectionId {
  try {
    const stored = localStorage.getItem(SKY_PROJECTION_STORAGE_KEY);
    return SKY_PROJECTIONS.some((p) => p.id === stored)
      ? (stored as SkyProjectionId)
      : DEFAULT_SKY_PROJECTION;
  } catch {
    return DEFAULT_SKY_PROJECTION;
  }
}

function saveProjection(id: SkyProjectionId): void {
  try {
    localStorage.setItem(SKY_PROJECTION_STORAGE_KEY, id);
  } catch {
    /* cosmetic */
  }
}

type Status = 'loading' | 'ready' | 'unavailable';

interface Layers {
  footprints: GraphicOverlay;
  emphasis: GraphicOverlay;
  region: GraphicOverlay;
}

type DrawMode = 'circle' | 'poly';

/** Build MOC JSON per density tier so denser cells draw more opaque. */
export function coverageTiers(
  grid: CoverageGrid
): { json: Record<string, number[]>; opacity: number }[] {
  const order = Math.round(Math.log2(grid.nside));
  const tiers: { min: number; opacity: number; pixels: number[] }[] = [
    { min: 10, opacity: 0.55, pixels: [] },
    { min: 3, opacity: 0.35, pixels: [] },
    { min: 1, opacity: 0.2, pixels: [] },
  ];
  for (const [pix, count] of grid.cells) {
    const tier = tiers.find((t) => count >= t.min);
    if (tier) tier.pixels.push(pix);
  }
  return tiers
    .filter((t) => t.pixels.length > 0)
    .map((t) => ({ json: { [String(order)]: t.pixels }, opacity: t.opacity }));
}

/**
 * Interactive sky map (Aladin Lite v3) for MAST results — MAST Search v2
 * Phase 5. Footprints are drawn from each row's `s_region` in one graphic
 * overlay, coloured by instrument; a second overlay carries the hovered and
 * selected footprints as thicker halos. Hover/click on the map are reported
 * by `obs_id` so the page can link them to table rows. The Aladin bundle is
 * loaded at runtime (`lib/loadAladin.ts`); when it cannot load (offline, no
 * WebGL2, timeout) the pane shows an `EmptyState` and the table stays usable.
 *
 * `React.lazy`-loadable: this module has no top-level side effects.
 */
const SkyMap = forwardRef<SkyMapHandle, SkyMapProps>(function SkyMap(
  {
    rows,
    hoverId = null,
    selectedIds,
    coverage = null,
    initialView,
    autoFit = true,
    onHover,
    onClick,
    onSkyClick,
    onViewChange,
    region = null,
    onRegionDrawn,
    onRegionClear,
    onReady,
    notice,
    className,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aladinRef = useRef<AladinInstance | null>(null);
  const ARef = useRef<AladinStatic | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const mocsRef = useRef<Moc[]>([]);
  const rowsRef = useRef<FootprintRow[]>(rows ?? []);
  const byIdRef = useRef<Map<string, Footprint[]>>(new Map());
  const hoverRef = useRef<string | null>(hoverId);
  const selectedRef = useRef<Set<string>>(new Set(selectedIds ?? []));
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [survey, setSurvey] = useState<SkySurveyId>(() => loadSurvey());
  const [projection, setProjection] = useState<SkyProjectionId>(() => loadProjection());
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const drawModeRef = useRef<DrawMode | null>(null);
  drawModeRef.current = drawMode;

  // Latest callbacks without re-subscribing Aladin events.
  const callbacks = useRef({ onHover, onClick, onSkyClick, onViewChange, onRegionDrawn });
  callbacks.current = { onHover, onClick, onSkyClick, onViewChange, onRegionDrawn };
  // Aladin fires objectClicked and then click for the SAME mouseup; without
  // this stamp a footprint click would also count as a sky click and the
  // page would push two searches.
  const lastObjectClickRef = useRef(0);

  const redrawEmphasis = useCallback(() => {
    const A = ARef.current;
    const layers = layersRef.current;
    if (!A || !layers) return;
    layers.emphasis.removeAll();
    const accent = cssToken('--accent-primary');
    const hot = cssToken('--accent-aqua');
    const ids = new Set<string>(selectedRef.current);
    if (hoverRef.current) ids.add(hoverRef.current);
    for (const id of ids) {
      const row = rowsRef.current.find((r) => r.obs_id === id);
      if (!row?.s_region) continue;
      const isHover = id === hoverRef.current;
      const shapes = A.footprintsFromSTCS(row.s_region, {
        color: isHover ? hot : accent,
        lineWidth: isHover ? 3 : 2,
        fillColor: withAlpha(isHover ? hot : accent, isHover ? 0.25 : 0.12),
      });
      shapes.forEach((s) => {
        s.data = { obsId: id, emphasis: true };
      });
      layers.emphasis.addFootprints(shapes);
    }
    layers.emphasis.reportChange();
  }, []);

  const drawFootprints = useCallback((next: FootprintRow[]) => {
    const A = ARef.current;
    const layers = layersRef.current;
    rowsRef.current = next;
    if (!A || !layers) return;
    layers.footprints.removeAll();
    const byId = new Map<string, Footprint[]>();
    for (const row of next) {
      if (!row.obs_id || !row.s_region) continue;
      let shapes: Footprint[];
      try {
        const color = instrumentColor(row.instrument_name);
        shapes = A.footprintsFromSTCS(row.s_region, {
          color,
          lineWidth: 1,
          fillColor: withAlpha(color, 0.06),
          hoverColor: cssToken('--accent-aqua'),
          selectionColor: cssToken('--accent-primary'),
        });
      } catch {
        continue;
      }
      if (shapes.length === 0) continue;
      shapes.forEach((s) => {
        s.data = { obsId: row.obs_id };
      });
      byId.set(row.obs_id, shapes);
      layers.footprints.addFootprints(shapes);
    }
    byIdRef.current = byId;
    layers.footprints.reportChange();
  }, []);

  const fitToResults = useCallback(() => {
    const aladin = aladinRef.current;
    if (!aladin) return;
    const polys = rowsRef.current.flatMap((r) => parseStcs(r.s_region));
    const bounds = footprintBounds(polys);
    const centre = footprintCentroid(polys);
    if (!bounds || !centre) return;
    aladin.gotoRaDec(centre.ra, centre.dec);
    aladin.setFoV(fovForBounds(bounds));
  }, []);

  const gotoView = useCallback((ra: number, dec: number, fov?: number) => {
    const aladin = aladinRef.current;
    if (!aladin) return;
    aladin.gotoRaDec(ra, dec);
    if (fov !== undefined) aladin.setFoV(fov);
  }, []);

  const drawCoverage = useCallback((grid: CoverageGrid | null) => {
    const A = ARef.current;
    const aladin = aladinRef.current;
    if (!A || !aladin) return;
    mocsRef.current.forEach((m) => m.hide());
    mocsRef.current = [];
    if (!grid || grid.cells.length === 0) return;
    const color = cssToken('--accent-aqua');
    for (const tier of coverageTiers(grid)) {
      try {
        const moc = A.MOCFromJSON(tier.json, {
          color,
          fillColor: color,
          opacity: tier.opacity,
          lineWidth: 0,
          perimeter: false,
          fill: true,
          edge: false,
          name: `jwst-coverage-${tier.opacity}`,
        });
        aladin.addMOC(moc);
        mocsRef.current.push(moc);
      } catch {
        /* a tier that fails to draw is not worth breaking the map over */
      }
    }
  }, []);

  /** Render the persistent drawn region on its own overlay. */
  const drawRegion = useCallback((next: SkyRegion | null) => {
    const A = ARef.current;
    const layers = layersRef.current;
    if (!A || !layers) return;
    layers.region.removeAll();
    if (next) {
      const color = cssToken('--accent-primary');
      const options = { color, lineWidth: 2, fillColor: withAlpha(color, 0.08) };
      const shape =
        next.kind === 'circle'
          ? A.circle(next.ra, next.dec, next.r, options)
          : A.polygon(
              next.vertices.map((p): [number, number] => [p.ra, p.dec]),
              options
            );
      layers.region.addFootprints([shape]);
    }
    layers.region.reportChange();
  }, []);

  /** Finish a draw: leave draw mode and report the shape, if it is usable. */
  const finishDraw = useCallback((next: SkyRegion | null) => {
    setDrawMode(null);
    if (next) callbacks.current.onRegionDrawn?.(next);
  }, []);

  const startDraw = useCallback(
    (mode: DrawMode) => {
      const aladin = aladinRef.current;
      if (!aladin) return;
      setDrawMode(mode);
      if (mode === 'circle') {
        aladin.select('circle', (sel) => {
          try {
            const [ra, dec] = aladin.pix2world(sel.x, sel.y, 'icrs');
            const r = aladin.angularDist(sel.x, sel.y, sel.x + sel.r, sel.y);
            finishDraw(
              Number.isFinite(ra) && Number.isFinite(dec) && Number.isFinite(r) && r > 0
                ? { kind: 'circle', ra, dec, r }
                : null
            );
          } catch {
            finishDraw(null); // drawn outside the projection
          }
        });
      } else {
        aladin.select('poly', (sel) => {
          try {
            const vertices = sel.vertices.map((v) => {
              const [ra, dec] = aladin.pix2world(v.x, v.y, 'icrs');
              return { ra, dec };
            });
            // Aladin can repeat the closing vertex; drop consecutive duplicates.
            const distinct = vertices.filter(
              (v, i) => i === 0 || v.ra !== vertices[i - 1].ra || v.dec !== vertices[i - 1].dec
            );
            finishDraw(distinct.length >= 3 ? { kind: 'polygon', vertices: distinct } : null);
          } catch {
            finishDraw(null);
          }
        });
      }
    },
    [finishDraw]
  );

  const cancelDraw = useCallback(() => {
    aladinRef.current?.fire('default');
    setDrawMode(null);
  }, []);

  // Escape cancels a draw in progress.
  useEffect(() => {
    if (!drawMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDraw();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawMode, cancelDraw]);

  useEffect(() => {
    if (status !== 'ready') return;
    drawRegion(region);
  }, [region, drawRegion, status]);

  const getView = useCallback((): SkyView | null => {
    const aladin = aladinRef.current;
    if (!aladin) return null;
    try {
      const [ra, dec] = aladin.getRaDec();
      const [fov] = aladin.getFov();
      return { ra, dec, fov };
    } catch {
      return null;
    }
  }, []);

  const handle = useMemo<SkyMapHandle>(
    () => ({
      setFootprints: (next) => {
        drawFootprints(next);
        redrawEmphasis();
      },
      highlight: (obsId) => {
        hoverRef.current = obsId;
        redrawEmphasis();
      },
      select: (ids) => {
        selectedRef.current = new Set(ids);
        redrawEmphasis();
      },
      fitToResults,
      goto: gotoView,
      setCoverage: drawCoverage,
      getView,
    }),
    [drawFootprints, redrawEmphasis, fitToResults, gotoView, drawCoverage, getView]
  );
  useImperativeHandle(ref, () => handle, [handle]);

  // Mount Aladin once.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    setStatus('loading');
    loadAladin()
      .then((A) => {
        if (cancelled || !containerRef.current) return;
        ARef.current = A;
        const aladin = A.aladin(containerRef.current, {
          survey: loadSurvey(),
          projection: loadProjection(),
          fov: initialView?.fov ?? DEFAULT_SKY_FOV,
          target: initialView ? `${initialView.ra ?? 0} ${initialView.dec ?? 0}` : '0 0',
          cooFrame: 'ICRS',
          showReticle: false,
          showLayersControl: false,
          showFullscreenControl: false,
          showGotoControl: false,
          showZoomControl: false,
          showSettingsControl: false,
          showShareControl: false,
          showSimbadPointerControl: false,
          showCooGridControl: false,
          showStatusBar: false,
          showFrame: false,
          showFov: false,
          showCooLocation: false,
          showProjectionControl: false,
          showContextMenu: false,
          mode: 'dark',
          backgroundColor: cssToken('--bg-canvas'),
        });
        aladinRef.current = aladin;
        const footprints = A.graphicOverlay({ name: 'mast-footprints' });
        const emphasis = A.graphicOverlay({ name: 'mast-emphasis' });
        const regionLayer = A.graphicOverlay({ name: 'mast-region' });
        aladin.addOverlay(footprints);
        aladin.addOverlay(emphasis);
        aladin.addOverlay(regionLayer);
        layersRef.current = { footprints, emphasis, region: regionLayer };

        aladin.on('objectHovered', (obj) => {
          const id = obj?.data?.obsId;
          if (typeof id === 'string' && !obj?.data?.emphasis) {
            callbacks.current.onHover?.(id);
          }
        });
        aladin.on('objectHoveredStop', () => {
          callbacks.current.onHover?.(null);
        });
        aladin.on('objectClicked', (obj) => {
          const id = obj?.data?.obsId;
          if (typeof id === 'string') {
            lastObjectClickRef.current = Date.now();
            callbacks.current.onClick?.(id);
          }
        });
        aladin.on('click', (ev) => {
          if (drawModeRef.current) return; // selection gesture, not a sky click
          if (ev.isDragging || ev.ra === null || ev.dec === null) return;
          if (Date.now() - lastObjectClickRef.current < 200) return; // same gesture hit a footprint
          callbacks.current.onSkyClick?.({ ra: ev.ra, dec: ev.dec });
        });
        let viewTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleView = () => {
          if (viewTimer) clearTimeout(viewTimer);
          viewTimer = setTimeout(() => {
            const v = getView();
            if (v) callbacks.current.onViewChange?.(v);
          }, VIEW_DEBOUNCE_MS);
        };
        aladin.on('positionChanged', scheduleView);
        aladin.on('zoomChanged', scheduleView);

        setStatus('ready');
        drawFootprints(rowsRef.current);
        redrawEmphasis();
        if (autoFit && rowsRef.current.length > 0) fitToResults();
        onReady?.(handle);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof AladinLoadError
            ? err.reason === 'no-webgl'
              ? 'This browser has no WebGL2, which the sky map needs.'
              : err.reason === 'timeout'
                ? 'The sky map library did not load in time.'
                : err.message
            : 'The sky map library failed to load.'
        );
        setStatus('unavailable');
      });
    return () => {
      cancelled = true;
      aladinRef.current = null;
      layersRef.current = null;
      mocsRef.current = [];
      if (container) container.replaceChildren();
    };
    // mount-only: later changes flow through the handle / the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declarative twins of the handle.
  useEffect(() => {
    if (!rows) return;
    const changed = rows !== rowsRef.current;
    drawFootprints(rows);
    redrawEmphasis();
    if (changed && autoFit && status === 'ready' && rows.length > 0) fitToResults();
  }, [rows, drawFootprints, redrawEmphasis, fitToResults, autoFit, status]);

  useEffect(() => {
    hoverRef.current = hoverId;
    redrawEmphasis();
  }, [hoverId, redrawEmphasis, status]);

  useEffect(() => {
    selectedRef.current = new Set(selectedIds ?? []);
    redrawEmphasis();
  }, [selectedIds, redrawEmphasis, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    drawCoverage(coverage);
  }, [coverage, drawCoverage, status]);

  // Survey switch (also re-applies after mount so the stored choice wins).
  useEffect(() => {
    const A = ARef.current;
    const aladin = aladinRef.current;
    if (!A || !aladin || status !== 'ready') return;
    setTileError(false);
    try {
      const layer = A.HiPS(survey, {
        errorCallback: () => setTileError(true),
      });
      aladin.setBaseImageLayer(layer);
    } catch {
      setTileError(true);
    }
  }, [survey, status]);

  // Projection switch (also re-applies after mount so the stored choice wins).
  useEffect(() => {
    const aladin = aladinRef.current;
    if (!aladin || status !== 'ready') return;
    try {
      aladin.setProjection(projection);
    } catch {
      /* an unsupported projection is not worth breaking the map over */
    }
  }, [projection, status]);

  useEffect(() => {
    const onOffline = () => setTileError(true);
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  const classes = ['sky-map'];
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ')} data-status={status}>
      <div
        ref={containerRef}
        className="sky-map-canvas"
        role="img"
        aria-label="Sky map of search results"
        data-testid="sky-map-canvas"
      />
      {status === 'loading' && (
        <div className="sky-map-loading" role="status">
          Loading sky map…
        </div>
      )}
      {status === 'unavailable' && (
        <div className="sky-map-unavailable">
          <EmptyState
            size="compact"
            bare
            title="Sky map unavailable"
            description={
              <>
                {loadError ?? 'The sky map could not start.'} The results table still works without
                it.
              </>
            }
          />
        </div>
      )}
      {status === 'ready' && (
        <>
          <div className="sky-map-chrome" role="toolbar" aria-label="Sky map controls">
            <label className="sky-map-survey">
              <span className="visually-hidden">Survey</span>
              <select
                value={survey}
                onChange={(e) => {
                  const next = e.target.value as SkySurveyId;
                  setSurvey(next);
                  saveSurvey(next);
                }}
                aria-label="Background survey"
              >
                {SKY_SURVEYS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sky-map-projection">
              <span className="visually-hidden">Projection</span>
              <select
                value={projection}
                onChange={(e) => {
                  const next = e.target.value as SkyProjectionId;
                  setProjection(next);
                  saveProjection(next);
                }}
                aria-label="Projection"
              >
                {SKY_PROJECTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-base btn-compact sky-map-fit"
              onClick={fitToResults}
              disabled={rowsRef.current.length === 0}
              title="Fit map to results"
            >
              Fit
            </button>
            {onRegionDrawn && (
              <div className="sky-map-draw" role="group" aria-label="Draw a search region">
                <button
                  type="button"
                  className="btn-base btn-compact sky-map-draw-btn"
                  aria-pressed={drawMode === 'circle'}
                  onClick={() => (drawMode === 'circle' ? cancelDraw() : startDraw('circle'))}
                  title="Draw a circle to search inside it"
                >
                  Circle
                </button>
                <button
                  type="button"
                  className="btn-base btn-compact sky-map-draw-btn"
                  aria-pressed={drawMode === 'poly'}
                  onClick={() => (drawMode === 'poly' ? cancelDraw() : startDraw('poly'))}
                  title="Draw a polygon to search inside it"
                >
                  Polygon
                </button>
                {(drawMode !== null || region) && (
                  <button
                    type="button"
                    className="btn-base btn-compact sky-map-draw-btn"
                    onClick={() => {
                      if (drawMode !== null) cancelDraw();
                      else onRegionClear?.();
                    }}
                    title={drawMode !== null ? 'Cancel drawing (Esc)' : 'Clear the drawn region'}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          {drawMode !== null && (
            <div className="sky-map-draw-hint" role="status">
              {drawMode === 'circle'
                ? 'Click and drag to draw a circle. Esc cancels.'
                : 'Click to add vertices; double-click to close. Esc cancels.'}
            </div>
          )}
          {(tileError || notice) && (
            <div className="sky-map-banner" role="status">
              {tileError ? (
                <span>Sky imagery unavailable — footprints are still shown.</span>
              ) : null}
              {notice ? <span>{notice}</span> : null}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default SkyMap;
