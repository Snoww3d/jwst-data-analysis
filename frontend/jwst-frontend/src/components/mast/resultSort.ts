import type { MastObservationResult } from '../../types/MastTypes';
import { toMjd } from '../../utils/timeUtils';
import { RESULT_COLUMNS, type ColumnKind } from './resultColumns';

export type SortDir = 'asc' | 'desc';

export interface ResultSort {
  key: string;
  dir: SortDir;
}

/** Newest releases first — what the old unsorted table happened to look like. */
export const DEFAULT_SORT: ResultSort = { key: 't_obs_release', dir: 'desc' };

const SORTABLE_KEYS = new Set<string>(RESULT_COLUMNS.map((c) => c.key));

/** `col:dir` → sort, or the default when absent / unknown column. */
export function parseSortParam(raw: string | undefined): ResultSort {
  if (!raw) return DEFAULT_SORT;
  const [key, dir] = raw.split(':');
  if (!SORTABLE_KEYS.has(key) || (dir !== 'asc' && dir !== 'desc')) return DEFAULT_SORT;
  return { key, dir };
}

/** Sort → `col:dir`, or undefined for the default (kept out of the URL). */
export function toSortParam(sort: ResultSort): string | undefined {
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return undefined;
  return `${sort.key}:${sort.dir}`;
}

/** Clicking a header: same column flips direction; a new column starts ascending. */
export function nextSort(current: ResultSort, key: string): ResultSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Null/undefined/blank/NaN all count as missing and sort last in either direction. */
function isMissing(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (typeof v === 'number' && Number.isNaN(v))
  );
}

function numeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compare two cell values of the given kind. Missing values sort after
 * present ones regardless of direction; a 0 return falls through to the
 * tiebreaker in `sortRows`.
 */
export function compareValues(a: unknown, b: unknown, kind: ColumnKind, dir: SortDir): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp: number;
  if (kind === 'string') {
    cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  } else {
    const an = kind === 'mjd' ? toMjd(a) : numeric(a);
    const bn = kind === 'mjd' ? toMjd(b) : numeric(b);
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    cmp = an - bn;
  }
  return dir === 'asc' ? cmp : -cmp;
}

/** A new, sorted array; the input is untouched. Ties break on obs_id. */
export function sortRows(rows: MastObservationResult[], sort: ResultSort): MastObservationResult[] {
  const column = RESULT_COLUMNS.find((c) => c.key === sort.key);
  if (!column) return [...rows];
  return [...rows].sort((a, b) => {
    const cmp = compareValues(a[column.key], b[column.key], column.kind, sort.dir);
    if (cmp !== 0) return cmp;
    return compareValues(a.obs_id, b.obs_id, 'string', 'asc');
  });
}
