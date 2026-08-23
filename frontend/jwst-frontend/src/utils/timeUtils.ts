/**
 * Modified Julian Date helpers. MAST reports every time column (`t_min`,
 * `t_max`, `t_obs_release`) as MJD; the UI shows calendar dates and the
 * filter rail (MAST Search v2 Phase 4) sends date ranges back as MJD.
 *
 * MJD 0 = 1858-11-17T00:00Z; the Unix epoch (1970-01-01) is MJD 40587.
 */

const UNIX_EPOCH_MJD = 40587;
const MS_PER_DAY = 86_400_000;

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - UNIX_EPOCH_MJD) * MS_PER_DAY);
}

export function dateToMjd(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_MJD;
}

/**
 * Coerce a MAST time value to an MJD number, or null. Numbers are MJD
 * already; strings are tried as a number, then as an ISO date (some rows
 * carry them that way).
 */
export function toMjd(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms / MS_PER_DAY + UNIX_EPOCH_MJD;
  }
  return null;
}

/** Locale date string for an MJD (or ISO string) cell; `-` when absent. */
export function formatMjdDate(value: unknown): string {
  const mjd = toMjd(value);
  if (mjd === null) return value === undefined || value === null ? '-' : String(value);
  return mjdToDate(mjd).toLocaleDateString();
}
