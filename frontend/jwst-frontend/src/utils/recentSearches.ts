/**
 * Recent MAST searches, kept in localStorage so the chips under the search
 * input survive reloads. Pure list functions + a thin storage wrapper.
 */

export const RECENT_SEARCHES_KEY = 'mast_recent_searches';
export const MAX_RECENT_SEARCHES = 10;

export interface RecentSearch {
  /** The raw query text as typed. */
  q: string;
  /** Radius in degrees as typed (only meaningful for target/coords). */
  r: string;
  /** Epoch ms when the search ran. */
  at: number;
}

/** Dedupe identity: whitespace-collapsed, case-folded query + radius. */
export function recentSearchKey(entry: Pick<RecentSearch, 'q' | 'r'>): string {
  const q = entry.q.trim().replace(/\s+/g, ' ').toLowerCase();
  const r = String(parseFloat(entry.r) || entry.r).trim();
  return `${q}|${r}`;
}

/**
 * Prepend `entry`, dropping any earlier entry with the same key and trimming
 * to `max`. Returns a new array; never mutates `list`.
 */
export function pushRecentSearch(
  list: RecentSearch[],
  entry: RecentSearch,
  max: number = MAX_RECENT_SEARCHES
): RecentSearch[] {
  const key = recentSearchKey(entry);
  const rest = list.filter((e) => recentSearchKey(e) !== key);
  return [entry, ...rest].slice(0, max);
}

function isRecentSearch(value: unknown): value is RecentSearch {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.q === 'string' && typeof v.r === 'string' && typeof v.at === 'number';
}

/** Read the stored list; malformed or missing storage yields []. */
export function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSearch).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** Persist; storage failures (quota, private mode) are swallowed. */
export function saveRecentSearches(list: RecentSearch[]): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    /* recents are a convenience — losing them is fine */
  }
}

/** Convenience: load, push, save, return the new list. */
export function recordRecentSearch(
  entry: Omit<RecentSearch, 'at'>,
  now = Date.now()
): RecentSearch[] {
  const next = pushRecentSearch(loadRecentSearches(), { ...entry, at: now });
  saveRecentSearches(next);
  return next;
}
