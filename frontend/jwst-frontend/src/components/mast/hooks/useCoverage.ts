import { useCallback, useEffect, useRef, useState } from 'react';
import { mastService } from '../../../services';
import type {
  MastCoverageFootprints,
  MastCoverageGrid,
  MastObservationResult,
} from '../../../types/MastTypes';

export type CoverageStatus = 'idle' | 'loading' | 'building' | 'ready' | 'error';

export interface CoverageState {
  status: CoverageStatus;
  grid: MastCoverageGrid | null;
  error: string | null;
}

/** Real footprints for a zoomed-in view (FOV below `FOOTPRINT_FOV_LIMIT`). */
export interface RegionFootprints {
  bbox: string;
  rows: MastObservationResult[];
  truncated: boolean;
}

/** Below this horizontal FOV (degrees) the map asks for real footprints. */
export const FOOTPRINT_FOV_LIMIT = 10;
const MAX_BUILD_POLLS = 12;
const MAX_RETRY_AFTER_S = 60;
const MIN_RETRY_AFTER_S = 5;

/** `ra_min,dec_min,ra_max,dec_max` for a view, cos(dec)-widened, RA may wrap. */
export function bboxForView(view: { ra: number; dec: number; fov: number }, aspect = 0.75): string {
  const halfH = Math.min(90, (view.fov * aspect) / 2) * 1.2;
  const decMin = Math.max(-90, view.dec - halfH);
  const decMax = Math.min(90, view.dec + halfH);
  const cosDec = Math.max(Math.cos((view.dec * Math.PI) / 180), 0.05);
  const halfW = Math.min(180, ((view.fov / 2) * 1.2) / cosDec);
  const wrap = (x: number) => ((x % 360) + 360) % 360;
  const raMin = halfW >= 180 ? 0 : wrap(view.ra - halfW);
  const raMax = halfW >= 180 ? 360 : wrap(view.ra + halfW);
  const f = (n: number) => Number(n.toFixed(3));
  return `${f(raMin)},${f(decMin)},${f(raMax)},${f(decMax)}`;
}

/**
 * Sky-coverage data for the browse-first empty state (MAST Search v2 Phase 5).
 *
 * `enabled` gates the whole-sky grid fetch (only the empty state needs it).
 * A 202 `building` reply is polled after the server's `retry_after`
 * (bounded), up to MAX_BUILD_POLLS times, then reported as an error.
 * `loadRegion(view)` fetches the real footprints for a zoomed-in view;
 * repeated calls with the same bbox are de-duplicated and an older
 * in-flight request is aborted.
 */
export function useCoverage(enabled: boolean) {
  const [state, setState] = useState<CoverageState>({ status: 'idle', grid: null, error: null });
  const [region, setRegion] = useState<RegionFootprints | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);
  const regionAbortRef = useRef<AbortController | null>(null);
  const lastBboxRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const attempt = async () => {
      setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }));
      try {
        const res = await mastService.getCoverage(undefined, controller.signal);
        if (cancelled) return;
        if ('status' in res && res.status === 'building') {
          polls += 1;
          if (polls > MAX_BUILD_POLLS) {
            setState({
              status: 'error',
              grid: null,
              error: res.error ?? 'Coverage is still being built — try again later.',
            });
            return;
          }
          const wait =
            Math.min(MAX_RETRY_AFTER_S, Math.max(MIN_RETRY_AFTER_S, res.retry_after || 20)) * 1000;
          setState({ status: 'building', grid: null, error: null });
          timer = setTimeout(() => void attempt(), wait);
          return;
        }
        if ('shape' in res && res.shape === 'grid') {
          setState({ status: 'ready', grid: res, error: null });
          return;
        }
        setState({ status: 'error', grid: null, error: 'Unexpected coverage response' });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          grid: null,
          error: err instanceof Error ? err.message : 'Coverage unavailable',
        });
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  const loadRegion = useCallback(async (view: { ra: number; dec: number; fov: number } | null) => {
    if (!view || view.fov >= FOOTPRINT_FOV_LIMIT) {
      regionAbortRef.current?.abort();
      regionAbortRef.current = null;
      lastBboxRef.current = null;
      setRegion(null);
      setRegionLoading(false);
      return;
    }
    const bbox = bboxForView(view);
    if (bbox === lastBboxRef.current) return;
    lastBboxRef.current = bbox;
    regionAbortRef.current?.abort();
    const controller = new AbortController();
    regionAbortRef.current = controller;
    setRegionLoading(true);
    try {
      const res = await mastService.getCoverage(bbox, controller.signal);
      if (controller.signal.aborted) return;
      if ('shape' in res && res.shape === 'footprints') {
        const fp = res as MastCoverageFootprints;
        setRegion({ bbox, rows: fp.rows, truncated: fp.truncated });
      }
    } catch {
      if (!controller.signal.aborted) setRegion(null);
    } finally {
      if (!controller.signal.aborted) setRegionLoading(false);
    }
  }, []);

  useEffect(() => () => regionAbortRef.current?.abort(), []);

  return { ...state, region, regionLoading, loadRegion };
}
