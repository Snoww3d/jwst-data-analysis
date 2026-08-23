/**
 * Filter-rail state for the MAST search page (MAST Search v2 Phase 4).
 *
 * `FacetState` is what the rail edits and what lives in the URL;
 * `buildCriteria` turns it into the wire `MastCriteria` the processing
 * engine whitelists (CAOM `query_criteria` names: lists are OR'd, two-tuples
 * are ranges, `*` is the MAST wildcard). Dates go over as MJD.
 *
 * URL params (reserved in useSearchUrlState since Phase 2):
 *   inst   instrument base names, repeated   (`inst=MIRI&inst=NIRCAM`)
 *   mode   instrument sub-modes, repeated    (`mode=IFU`)
 *   filt   filter names, repeated            (`filt=F200W`)
 *   dpt    data product types, repeated      (`dpt=cube`)
 *   calib  `all` (levels 1–3) or a comma list (`calib=2,3`); absent → 3
 *   from   observation start ≥ this date     (`from=2024-01-01`)
 *   to     observation start ≤ this date
 *   exp    exposure seconds `min-max`, either side optional (`exp=10-`)
 *   intent `calibration` | `any`; absent → science
 *   days   facet-only release window in days (absent → server default 90)
 */

import { dateToMjd } from './timeUtils';

export const INSTRUMENTS = ['NIRCAM', 'NIRSPEC', 'MIRI', 'NIRISS', 'FGS'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const INSTRUMENT_MODES = ['IMAGE', 'IFU', 'MSA', 'SLIT'] as const;
export type InstrumentMode = (typeof INSTRUMENT_MODES)[number];

export const DATAPRODUCT_TYPES = ['image', 'spectrum', 'cube', 'timeseries'] as const;
export type DataproductType = (typeof DATAPRODUCT_TYPES)[number];

export const CALIB_LEVELS = [1, 2, 3] as const;
export const DEFAULT_CALIB_LEVELS: readonly number[] = [3];

export type Intent = 'science' | 'calibration' | 'any';

/** Facet-only searches widen to this when the default 90-day window is removed. */
export const WIDE_WINDOW_DAYS = 365;
/** Server cap on `days_back` (mirrors MAX_FACET_DAYS_BACK in models.py). */
export const MAX_WINDOW_DAYS = 3650;

export interface FacetState {
  /** Instrument base names, uppercase (`MIRI`). Empty → any. */
  instruments: string[];
  /** Sub-modes applied to every selected instrument (`IFU`). Empty → any. */
  modes: string[];
  /** Filter names, uppercase (`F200W`). Empty → any. */
  filters: string[];
  /** `image` / `spectrum` / `cube` / `timeseries`. Empty → any. */
  dataproductTypes: string[];
  /** Calibration levels, ascending. Default `[3]`. */
  calibLevels: number[];
  /** `YYYY-MM-DD` or empty. Observation start on/after this day. */
  dateFrom: string;
  /** `YYYY-MM-DD` or empty. Observation start on/before this day. */
  dateTo: string;
  /** Exposure seconds, as typed; empty → unbounded. */
  expMin: string;
  expMax: string;
  /** Science is the default and IS sent (`intentType: ['science']`). */
  intent: Intent;
  /**
   * Facet-only searches: explicit release window. Absent → the server applies
   * its default (90 days) and reports `default_window_applied`. Ignored when a
   * date facet is set, and when the search has a query.
   */
  daysBack?: number;
}

export const EMPTY_FACETS: FacetState = Object.freeze({
  instruments: [],
  modes: [],
  filters: [],
  dataproductTypes: [],
  calibLevels: [...DEFAULT_CALIB_LEVELS],
  dateFrom: '',
  dateTo: '',
  expMin: '',
  expMax: '',
  intent: 'science',
}) as FacetState;

/** Wire shape of the processing engine's `MastCriteria` whitelist. */
export interface MastCriteria {
  instrument_name?: string[];
  filters?: string[];
  dataproduct_type?: string[];
  intentType?: string[];
  t_min?: [number, number];
  t_exptime?: [number, number];
}

const CRITERIA_VALUE_RE = /^[A-Za-z0-9_./*-]+$/;
const MAX_LIST_ITEMS = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXP_RE = /^(\d*\.?\d*)-(\d*\.?\d*)$/;
/** Open upper bound for an exposure range (seconds; ~116 days). */
const EXP_OPEN_MAX = 1e7;

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** True when every field is at its default — nothing to send, nothing to show. */
export function isEmptyFacets(f: FacetState): boolean {
  return (
    f.instruments.length === 0 &&
    f.modes.length === 0 &&
    f.filters.length === 0 &&
    f.dataproductTypes.length === 0 &&
    sameList(f.calibLevels, DEFAULT_CALIB_LEVELS) &&
    !f.dateFrom &&
    !f.dateTo &&
    !f.expMin &&
    !f.expMax &&
    f.intent === 'science' &&
    f.daysBack === undefined
  );
}

/**
 * True when at least one facet NARROWS the archive (instrument, mode,
 * filter, product type, date, exposure). Calibration level, intent and the
 * release window are modifiers — on their own they do not make a search,
 * so `/search?calib=all` with no query still shows the empty state.
 */
export function hasNarrowingFacets(f: FacetState): boolean {
  return Boolean(
    f.instruments.length ||
    f.modes.length ||
    f.filters.length ||
    f.dataproductTypes.length ||
    f.dateFrom ||
    f.dateTo ||
    f.expMin ||
    f.expMax
  );
}

export function facetsEqual(a: FacetState, b: FacetState): boolean {
  return (
    sameList(a.instruments, b.instruments) &&
    sameList(a.modes, b.modes) &&
    sameList(a.filters, b.filters) &&
    sameList(a.dataproductTypes, b.dataproductTypes) &&
    sameList(a.calibLevels, b.calibLevels) &&
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    a.expMin === b.expMin &&
    a.expMax === b.expMax &&
    a.intent === b.intent &&
    a.daysBack === b.daysBack
  );
}

/** Whether the date facet is in play (it supersedes `daysBack`). */
export function hasDateFacet(f: FacetState): boolean {
  return Boolean(f.dateFrom || f.dateTo);
}

/** Parse a `YYYY-MM-DD` string as midnight UTC; null when malformed. */
function parseIsoDay(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSeconds(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The wire criteria for a facet state, or undefined when nothing would be
 * sent. Only non-empty fields appear; a half-open date or exposure range is
 * closed with 0 / today+1 / EXP_OPEN_MAX because MAST ranges need both ends.
 */
export function buildCriteria(f: FacetState): MastCriteria | undefined {
  const out: MastCriteria = {};

  const instruments = uniqSorted(f.instruments);
  const modes = uniqSorted(f.modes);
  if (instruments.length && modes.length) {
    out.instrument_name = instruments.flatMap((i) => modes.map((m) => `${i}/${m}`));
  } else if (instruments.length) {
    // `MIRI*` matches both a bare `MIRI` and every `MIRI/<mode>` value
    out.instrument_name = instruments.map((i) => `${i}*`);
  } else if (modes.length) {
    out.instrument_name = modes.map((m) => `*/${m}`);
  }

  if (f.filters.length) out.filters = uniqSorted(f.filters.map((x) => x.toUpperCase()));
  if (f.dataproductTypes.length) out.dataproduct_type = uniqSorted(f.dataproductTypes);
  if (f.intent !== 'any') out.intentType = [f.intent];

  const from = f.dateFrom ? parseIsoDay(f.dateFrom) : null;
  const to = f.dateTo ? parseIsoDay(f.dateTo) : null;
  if (from || to) {
    const lo = from ? dateToMjd(from) : 0;
    // end of the `to` day; open-ended → end of today
    const hi = to ? dateToMjd(to) + 1 : Math.ceil(dateToMjd(new Date())) + 1;
    if (lo <= hi) out.t_min = [lo, hi];
  }

  const expMin = parseSeconds(f.expMin);
  const expMax = parseSeconds(f.expMax);
  if (expMin !== null || expMax !== null) {
    const lo = expMin ?? 0;
    const hi = expMax ?? EXP_OPEN_MAX;
    if (lo <= hi) out.t_exptime = [lo, hi];
  }

  return Object.keys(out).length ? out : undefined;
}

/** The `calib` URL value for a level list; undefined when it is the default. */
export function calibLevelsToParam(levels: readonly number[]): string | undefined {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  if (sameList(sorted, DEFAULT_CALIB_LEVELS)) return undefined;
  if (sameList(sorted, CALIB_LEVELS)) return 'all';
  return sorted.join(',');
}

/** Levels for a `calib` URL value; malformed → the default. */
export function calibLevelsFromParam(raw: string | null): number[] {
  if (!raw) return [...DEFAULT_CALIB_LEVELS];
  if (raw === 'all') return [...CALIB_LEVELS];
  const levels = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => (CALIB_LEVELS as readonly number[]).includes(n));
  return levels.length ? [...new Set(levels)].sort((a, b) => a - b) : [...DEFAULT_CALIB_LEVELS];
}

/** Write the facet params onto `params` (only non-defaults). */
export function facetsToUrl(f: FacetState, params: URLSearchParams): void {
  for (const v of uniqSorted(f.instruments)) params.append('inst', v);
  for (const v of uniqSorted(f.modes)) params.append('mode', v);
  for (const v of uniqSorted(f.filters.map((x) => x.toUpperCase()))) params.append('filt', v);
  for (const v of uniqSorted(f.dataproductTypes)) params.append('dpt', v);
  const calib = calibLevelsToParam(f.calibLevels);
  if (calib) params.set('calib', calib);
  if (f.dateFrom && DATE_RE.test(f.dateFrom)) params.set('from', f.dateFrom);
  if (f.dateTo && DATE_RE.test(f.dateTo)) params.set('to', f.dateTo);
  if (f.expMin || f.expMax) params.set('exp', `${f.expMin.trim()}-${f.expMax.trim()}`);
  if (f.intent !== 'science') params.set('intent', f.intent);
  if (f.daysBack !== undefined) params.set('days', String(f.daysBack));
}

/**
 * Read the facet params. Anything hand-edited into nonsense is dropped rather
 * than sent on (the server would 400 it anyway).
 */
export function urlToFacets(params: URLSearchParams): FacetState {
  const oneOf = <T extends string>(key: string, allowed: readonly T[], upper = false): T[] =>
    uniqSorted(
      params
        .getAll(key)
        .map((v) => (upper ? v.trim().toUpperCase() : v.trim()))
        .filter((v): v is T => (allowed as readonly string[]).includes(v))
    ) as T[];

  const filters = uniqSorted(
    params
      .getAll('filt')
      .map((v) => v.trim().toUpperCase())
      .filter((v) => v && CRITERIA_VALUE_RE.test(v))
  ).slice(0, MAX_LIST_ITEMS);

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  let expMin = '';
  let expMax = '';
  const exp = params.get('exp');
  const expMatch = exp ? EXP_RE.exec(exp) : null;
  if (expMatch) {
    if (parseSeconds(expMatch[1]) !== null) expMin = expMatch[1];
    if (parseSeconds(expMatch[2]) !== null) expMax = expMatch[2];
  }

  const intentRaw = params.get('intent');
  const intent: Intent = intentRaw === 'calibration' || intentRaw === 'any' ? intentRaw : 'science';

  const daysRaw = params.get('days');
  const days = daysRaw ? Number(daysRaw) : NaN;
  const daysBack =
    Number.isInteger(days) && days >= 1 && days <= MAX_WINDOW_DAYS ? days : undefined;

  const state: FacetState = {
    instruments: oneOf('inst', INSTRUMENTS, true),
    modes: oneOf('mode', INSTRUMENT_MODES, true),
    filters,
    dataproductTypes: oneOf('dpt', DATAPRODUCT_TYPES),
    calibLevels: calibLevelsFromParam(params.get('calib')),
    dateFrom: parseIsoDay(from) ? from : '',
    dateTo: parseIsoDay(to) ? to : '',
    expMin,
    expMax,
    intent,
  };
  if (daysBack !== undefined) state.daysBack = daysBack;
  return state;
}

/** Swatch colour family for an active-filter chip. */
export type ChipKind =
  | 'nircam'
  | 'nirspec'
  | 'miri'
  | 'niriss'
  | 'fgs'
  | 'mode'
  | 'filter'
  | 'dpt'
  | 'calib'
  | 'date'
  | 'exp'
  | 'intent'
  | 'window';

export interface ActiveChip {
  /** Stable id; `removeFacetChip` understands it. */
  key: string;
  /** Already uppercase — chips render in monospace caps (design rule). */
  label: string;
  kind: ChipKind;
  /** False for the widened release window, which only a date range replaces. */
  removable: boolean;
}

/**
 * The chips for a facet state. The default 90-day window is not in the state
 * (the server applies it); pass `defaultWindowApplied` from the response to
 * show it. Both window chips only appear for facet-only searches, which is
 * the caller's call (`showWindow`).
 */
export function describeFacets(
  f: FacetState,
  opts: { showWindow: boolean; defaultWindowApplied: boolean }
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const i of f.instruments) {
    chips.push({
      key: `inst:${i}`,
      label: i,
      kind: i.toLowerCase() as ChipKind,
      removable: true,
    });
  }
  for (const m of f.modes)
    chips.push({ key: `mode:${m}`, label: m, kind: 'mode', removable: true });
  for (const x of f.filters) {
    chips.push({ key: `filt:${x}`, label: x, kind: 'filter', removable: true });
  }
  for (const d of f.dataproductTypes) {
    chips.push({ key: `dpt:${d}`, label: d.toUpperCase(), kind: 'dpt', removable: true });
  }
  const calib = calibLevelsToParam(f.calibLevels);
  if (calib) {
    chips.push({
      key: 'calib',
      label: `LEVEL ${f.calibLevels.join(',')}`,
      kind: 'calib',
      removable: true,
    });
  }
  if (f.dateFrom)
    chips.push({ key: 'from', label: `FROM ${f.dateFrom}`, kind: 'date', removable: true });
  if (f.dateTo) chips.push({ key: 'to', label: `TO ${f.dateTo}`, kind: 'date', removable: true });
  if (f.expMin)
    chips.push({ key: 'expMin', label: `EXP ≥ ${f.expMin} S`, kind: 'exp', removable: true });
  if (f.expMax)
    chips.push({ key: 'expMax', label: `EXP ≤ ${f.expMax} S`, kind: 'exp', removable: true });
  if (f.intent !== 'science') {
    chips.push({
      key: 'intent',
      label: f.intent === 'any' ? 'ANY INTENT' : 'CALIBRATION',
      kind: 'intent',
      removable: true,
    });
  }
  if (opts.showWindow && !hasDateFacet(f)) {
    if (f.daysBack !== undefined) {
      chips.push({
        key: 'days',
        label: `LAST ${f.daysBack} DAYS`,
        kind: 'window',
        removable: false,
      });
    } else if (opts.defaultWindowApplied) {
      chips.push({ key: 'days', label: 'LAST 90 DAYS', kind: 'window', removable: true });
    }
  }
  return chips;
}

/**
 * The state after removing one chip. Removing the default window WIDENS it
 * (to `WIDE_WINDOW_DAYS`) rather than dropping the bound — a bare "MIRI"
 * must never pull the whole archive.
 */
export function removeFacetChip(f: FacetState, key: string): FacetState {
  const [field, value] = key.split(':', 2);
  const without = (list: string[]) => list.filter((v) => v !== value);
  switch (field) {
    case 'inst':
      return { ...f, instruments: without(f.instruments) };
    case 'mode':
      return { ...f, modes: without(f.modes) };
    case 'filt':
      return { ...f, filters: without(f.filters) };
    case 'dpt':
      return { ...f, dataproductTypes: without(f.dataproductTypes) };
    case 'calib':
      return { ...f, calibLevels: [...DEFAULT_CALIB_LEVELS] };
    case 'from':
      return { ...f, dateFrom: '' };
    case 'to':
      return { ...f, dateTo: '' };
    case 'expMin':
      return { ...f, expMin: '' };
    case 'expMax':
      return { ...f, expMax: '' };
    case 'intent':
      return { ...f, intent: 'science' };
    case 'days':
      return f.daysBack === undefined ? { ...f, daysBack: WIDE_WINDOW_DAYS } : f;
    default:
      return f;
  }
}
