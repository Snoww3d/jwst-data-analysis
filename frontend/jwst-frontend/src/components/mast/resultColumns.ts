import type { MastObservationResult } from '../../types/MastTypes';

/** How a column's values compare when sorted. */
export type ColumnKind = 'string' | 'number' | 'mjd';

export interface ResultColumn {
  /** CAOM column name — also the `sort=` key in the URL. */
  key: keyof MastObservationResult & string;
  label: string;
  kind: ColumnKind;
  /** Always shown; not offered in the column picker. */
  fixed?: boolean;
  /** Rendered in monospace (IDs, coordinates). */
  mono?: boolean;
  /** Right-aligned numeric cell. */
  numeric?: boolean;
}

/** Every sortable data column, in display order. */
export const RESULT_COLUMNS: readonly ResultColumn[] = [
  { key: 'obs_id', label: 'Obs ID', kind: 'string', fixed: true, mono: true },
  { key: 'target_name', label: 'Target', kind: 'string', fixed: true },
  { key: 'instrument_name', label: 'Instrument', kind: 'string', fixed: true },
  { key: 'filters', label: 'Filter', kind: 'string', fixed: true, mono: true },
  { key: 't_exptime', label: 'Exp Time', kind: 'number', fixed: true, numeric: true },
  { key: 't_min', label: 'Obs Date', kind: 'mjd', fixed: true },
  { key: 't_max', label: 'Obs End', kind: 'mjd' },
  { key: 't_obs_release', label: 'Release Date', kind: 'mjd', fixed: true },
  { key: 's_ra', label: 'RA', kind: 'number', mono: true, numeric: true },
  { key: 's_dec', label: 'Dec', kind: 'number', mono: true, numeric: true },
  { key: 'proposal_pi', label: 'PI', kind: 'string' },
  { key: 'obs_collection', label: 'Collection', kind: 'string' },
  { key: 'calib_level', label: 'Calib', kind: 'number', numeric: true },
];

export const OPTIONAL_COLUMN_KEYS: readonly string[] = RESULT_COLUMNS.filter((c) => !c.fixed).map(
  (c) => c.key
);

export const COLUMNS_STORAGE_KEY = 'mast_columns';

/** Optional columns shown by default: none — the fixed set is the classic table. */
export const DEFAULT_OPTIONAL_COLUMNS: readonly string[] = [];

/** The optional column keys the user has switched on, from localStorage. */
export function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_OPTIONAL_COLUMNS);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_OPTIONAL_COLUMNS);
    return new Set(
      parsed.filter((k): k is string => typeof k === 'string' && OPTIONAL_COLUMN_KEYS.includes(k))
    );
  } catch {
    return new Set(DEFAULT_OPTIONAL_COLUMNS);
  }
}

export function saveVisibleColumns(visible: Set<string>): void {
  try {
    localStorage.setItem(
      COLUMNS_STORAGE_KEY,
      JSON.stringify(OPTIONAL_COLUMN_KEYS.filter((k) => visible.has(k)))
    );
  } catch {
    /* storage full or disabled — the choice just won't persist */
  }
}

/** The columns to render, in display order, given the user's optional picks. */
export function activeColumns(visible: Set<string>): ResultColumn[] {
  return RESULT_COLUMNS.filter((c) => c.fixed || visible.has(c.key));
}
