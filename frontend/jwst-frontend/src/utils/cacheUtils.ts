const CACHE_PREFIX = 'jwst_cache_';
const CACHE_VERSION = 1;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: number;
}

export interface CacheStats {
  totalBytes: number;
  entryCount: number;
  entries: { key: string; bytes: number; ageMs: number }[];
}

export function getCached<T>(key: string, ttlMs: number): T | null {
  try {
    const fullKey = CACHE_PREFIX + key;
    const raw = localStorage.getItem(fullKey);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    if (Date.now() - entry.timestamp > ttlMs) return null;

    // Touch timestamp on read for LRU accuracy
    try {
      entry.timestamp = Date.now();
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // Quota error on touch is fine — data is still valid
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function getStale<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Evicts the oldest jwst_cache_* entry from localStorage.
 * Returns true if an entry was evicted, false if none remain.
 */
function evictOldest(): boolean {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const entry: CacheEntry<unknown> = JSON.parse(raw);
      if (typeof entry.timestamp === 'number' && entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    } catch {
      // Unparseable entry — evict it first as it's likely corrupt
      localStorage.removeItem(key);
      return true;
    }
  }

  if (oldestKey) {
    localStorage.removeItem(oldestKey);
    return true;
  }
  return false;
}

export function setCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    version: CACHE_VERSION,
  };
  const json = JSON.stringify(entry);
  const fullKey = CACHE_PREFIX + key;

  for (;;) {
    try {
      localStorage.setItem(fullKey, json);
      return;
    } catch {
      // Quota exceeded — evict oldest entry and retry
      if (!evictOldest()) {
        // Nothing left to evict — silent no-op
        return;
      }
    }
  }
}

export function getCacheStats(): CacheStats {
  const now = Date.now();
  const entries: CacheStats['entries'] = [];
  let totalBytes = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    const bytes = key.length + raw.length; // Characters ≈ bytes for localStorage (UTF-16, but close enough for reporting)
    totalBytes += bytes;

    let ageMs: number;
    try {
      const entry: CacheEntry<unknown> = JSON.parse(raw);
      ageMs = now - entry.timestamp;
    } catch {
      ageMs = -1; // Corrupt entry
    }

    entries.push({ key: key.slice(CACHE_PREFIX.length), bytes, ageMs });
  }

  entries.sort((a, b) => b.bytes - a.bytes); // Largest first

  return { totalBytes, entryCount: entries.length, entries };
}

export function clearCacheByPrefix(prefix: string): void {
  try {
    const fullPrefix = CACHE_PREFIX + prefix;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(fullPrefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // silent no-op
  }
}

/**
 * Clear ALL jwst_cache_* entries from localStorage.
 * Returns the number of entries cleared.
 */
export function clearAllCache(): number {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
  return keysToRemove.length;
}
