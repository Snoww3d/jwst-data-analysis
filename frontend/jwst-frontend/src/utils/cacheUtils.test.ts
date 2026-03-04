import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCached, getStale, setCache, clearCacheByPrefix, getCacheStats } from './cacheUtils';

// Mock localStorage with optional quota simulation
const mockStorage = new Map<string, string>();
let quotaLimit: number | null = null; // null = no limit

vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => {
    if (quotaLimit !== null) {
      // Estimate total size after this write
      const currentSize = [...mockStorage.entries()].reduce(
        (sum, [k, v]) => sum + k.length + v.length,
        0
      );
      const existingSize = mockStorage.has(key)
        ? key.length + (mockStorage.get(key)?.length ?? 0)
        : 0;
      const newTotal = currentSize - existingSize + key.length + val.length;
      if (newTotal > quotaLimit) {
        throw new Error('QuotaExceededError');
      }
    }
    mockStorage.set(key, val);
  },
  removeItem: (key: string) => mockStorage.delete(key),
  get length() {
    return mockStorage.size;
  },
  key: (i: number) => [...mockStorage.keys()][i] ?? null,
  clear: () => mockStorage.clear(),
});

beforeEach(() => {
  mockStorage.clear();
  quotaLimit = null;
});

describe('setCache + getCached', () => {
  it('stores and retrieves data within TTL', () => {
    setCache('test-key', { value: 42 });
    const result = getCached<{ value: number }>('test-key', 60_000);
    expect(result).toEqual({ value: 42 });
  });

  it('stores and retrieves string data', () => {
    setCache('str-key', 'hello world');
    const result = getCached<string>('str-key', 60_000);
    expect(result).toBe('hello world');
  });

  it('stores and retrieves array data', () => {
    setCache('arr-key', [1, 2, 3]);
    const result = getCached<number[]>('arr-key', 60_000);
    expect(result).toEqual([1, 2, 3]);
  });

  it('overwrites existing key', () => {
    setCache('key', 'first');
    setCache('key', 'second');
    expect(getCached<string>('key', 60_000)).toBe('second');
  });
});

describe('getCached', () => {
  it('returns null for missing key', () => {
    expect(getCached('nonexistent', 60_000)).toBeNull();
  });

  it('returns null for expired data', () => {
    // Manually insert an entry with old timestamp
    const entry = {
      data: 'old data',
      timestamp: Date.now() - 120_000, // 2 minutes ago
      version: 1,
    };
    mockStorage.set('jwst_cache_expired-key', JSON.stringify(entry));

    expect(getCached('expired-key', 60_000)).toBeNull();
  });

  it('returns data that is not yet expired', () => {
    const entry = {
      data: 'fresh data',
      timestamp: Date.now() - 30_000, // 30 seconds ago
      version: 1,
    };
    mockStorage.set('jwst_cache_fresh-key', JSON.stringify(entry));

    expect(getCached<string>('fresh-key', 60_000)).toBe('fresh data');
  });

  it('returns null for wrong version', () => {
    const entry = {
      data: 'v0 data',
      timestamp: Date.now(),
      version: 0, // Wrong version
    };
    mockStorage.set('jwst_cache_wrong-ver', JSON.stringify(entry));

    expect(getCached('wrong-ver', 60_000)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    mockStorage.set('jwst_cache_bad-json', 'not valid json{{{');
    expect(getCached('bad-json', 60_000)).toBeNull();
  });

  it('uses correct prefix "jwst_cache_"', () => {
    setCache('my-key', 'data');
    expect(mockStorage.has('jwst_cache_my-key')).toBe(true);
    expect(mockStorage.has('my-key')).toBe(false);
  });
});

describe('getStale', () => {
  it('returns data even if expired', () => {
    const entry = {
      data: 'stale data',
      timestamp: Date.now() - 999_999_999, // Very old
      version: 1,
    };
    mockStorage.set('jwst_cache_stale-key', JSON.stringify(entry));

    expect(getStale<string>('stale-key')).toBe('stale data');
  });

  it('returns null for missing key', () => {
    expect(getStale('nonexistent')).toBeNull();
  });

  it('returns null for wrong version', () => {
    const entry = {
      data: 'v0 data',
      timestamp: Date.now(),
      version: 99,
    };
    mockStorage.set('jwst_cache_bad-ver', JSON.stringify(entry));

    expect(getStale('bad-ver')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    mockStorage.set('jwst_cache_bad', '!!invalid!!');
    expect(getStale('bad')).toBeNull();
  });

  it('returns fresh data too', () => {
    setCache('fresh', { x: 1 });
    expect(getStale<{ x: number }>('fresh')).toEqual({ x: 1 });
  });
});

describe('clearCacheByPrefix', () => {
  it('removes matching keys', () => {
    setCache('images_1', 'a');
    setCache('images_2', 'b');
    setCache('other_1', 'c');

    clearCacheByPrefix('images_');

    expect(getCached('images_1', 60_000)).toBeNull();
    expect(getCached('images_2', 60_000)).toBeNull();
  });

  it('keeps non-matching keys', () => {
    setCache('images_1', 'a');
    setCache('other_1', 'c');

    clearCacheByPrefix('images_');

    expect(getCached<string>('other_1', 60_000)).toBe('c');
  });

  it('handles empty storage gracefully', () => {
    // Should not throw
    expect(() => clearCacheByPrefix('anything')).not.toThrow();
  });

  it('removes exact prefix matches only', () => {
    setCache('img', 'a');
    setCache('images', 'b');
    setCache('img_data', 'c');

    clearCacheByPrefix('img_');

    // Only 'img_data' should be removed (full prefix match)
    expect(getCached<string>('img', 60_000)).toBe('a');
    expect(getCached<string>('images', 60_000)).toBe('b');
    expect(getCached('img_data', 60_000)).toBeNull();
  });

  it('clears all cache entries with empty prefix', () => {
    setCache('a', 1);
    setCache('b', 2);
    setCache('c', 3);

    clearCacheByPrefix('');

    expect(getCached('a', 60_000)).toBeNull();
    expect(getCached('b', 60_000)).toBeNull();
    expect(getCached('c', 60_000)).toBeNull();
  });
});

describe('LRU eviction', () => {
  it('evicts oldest entry when quota is exceeded', () => {
    // Write two small entries with known timestamps
    const oldEntry = JSON.stringify({ data: 'old', timestamp: 1000, version: 1 });
    const newEntry = JSON.stringify({ data: 'new', timestamp: 2000, version: 1 });
    mockStorage.set('jwst_cache_old-key', oldEntry);
    mockStorage.set('jwst_cache_new-key', newEntry);

    // Calculate current total size
    const currentSize = [...mockStorage.entries()].reduce(
      (sum, [k, v]) => sum + k.length + v.length,
      0
    );

    // Build what setCache will try to write, so we can size the quota
    const newCacheEntry = JSON.stringify({ data: 'data', timestamp: Date.now(), version: 1 });
    const newKeySize = 'jwst_cache_another'.length + newCacheEntry.length;

    // Set quota so all 3 don't fit, but 2 (new-key + another) do
    const oldKeySize = 'jwst_cache_old-key'.length + oldEntry.length;
    quotaLimit = currentSize - oldKeySize + newKeySize + 1;

    setCache('another', 'data');

    // old-key should have been evicted
    expect(mockStorage.has('jwst_cache_old-key')).toBe(false);
    // new-key should survive
    expect(mockStorage.has('jwst_cache_new-key')).toBe(true);
    // new entry should be stored
    expect(mockStorage.has('jwst_cache_another')).toBe(true);
  });

  it('evicts multiple entries if needed', () => {
    // Insert 3 entries with ascending timestamps
    for (let i = 0; i < 3; i++) {
      mockStorage.set(
        `jwst_cache_entry-${i}`,
        JSON.stringify({ data: 'x'.repeat(50), timestamp: 1000 + i, version: 1 })
      );
    }

    // Set a very tight quota — only room for the new entry
    quotaLimit = 300;

    setCache('big', 'y'.repeat(50));

    expect(mockStorage.has('jwst_cache_big')).toBe(true);
    // At least some old entries should have been evicted
    const remaining = [...mockStorage.keys()].filter((k) => k.startsWith('jwst_cache_entry-'));
    expect(remaining.length).toBeLessThan(3);
  });

  it('silently no-ops when entry is too large even after evicting everything', () => {
    // Set very small quota
    quotaLimit = 10;

    // Should not throw
    expect(() => setCache('huge', 'x'.repeat(1000))).not.toThrow();
    // Entry should not be stored
    expect(mockStorage.has('jwst_cache_huge')).toBe(false);
  });

  it('does not evict non-cache keys', () => {
    mockStorage.set('other_app_key', 'important data');
    mockStorage.set('jwst_cache_old', JSON.stringify({ data: 'x', timestamp: 1000, version: 1 }));

    // Tight quota
    quotaLimit = 200;

    setCache('new-entry', 'data');

    // Non-cache key must survive
    expect(mockStorage.has('other_app_key')).toBe(true);
  });
});

describe('getCached touch-on-read', () => {
  it('updates timestamp on cache hit', () => {
    const oldTimestamp = Date.now() - 60_000;
    mockStorage.set(
      'jwst_cache_touch-test',
      JSON.stringify({ data: 'value', timestamp: oldTimestamp, version: 1 })
    );

    const result = getCached<string>('touch-test', 120_000);
    expect(result).toBe('value');

    // Verify timestamp was updated
    const raw = mockStorage.get('jwst_cache_touch-test') ?? '';
    const entry = JSON.parse(raw);
    expect(entry.timestamp).toBeGreaterThan(oldTimestamp);
    expect(entry.timestamp).toBeCloseTo(Date.now(), -2); // Within ~100ms
  });

  it('does not touch timestamp for expired entries', () => {
    const oldTimestamp = Date.now() - 120_000;
    const json = JSON.stringify({ data: 'expired', timestamp: oldTimestamp, version: 1 });
    mockStorage.set('jwst_cache_expired-touch', json);

    const result = getCached<string>('expired-touch', 60_000);
    expect(result).toBeNull();

    // Timestamp should not have changed
    expect(mockStorage.get('jwst_cache_expired-touch')).toBe(json);
  });

  it('still returns data if touch write fails due to quota', () => {
    setCache('quota-touch', 'value');

    // Now set quota to prevent writes but allow reads
    quotaLimit = 1;

    const result = getCached<string>('quota-touch', 60_000);
    expect(result).toBe('value');
  });
});

describe('getCacheStats', () => {
  it('returns empty stats for empty cache', () => {
    const stats = getCacheStats();
    expect(stats.totalBytes).toBe(0);
    expect(stats.entryCount).toBe(0);
    expect(stats.entries).toEqual([]);
  });

  it('counts only jwst_cache_ entries', () => {
    setCache('a', 'data-a');
    setCache('b', 'data-b');
    mockStorage.set('other_key', 'not counted');

    const stats = getCacheStats();
    expect(stats.entryCount).toBe(2);
  });

  it('reports bytes and age for each entry', () => {
    setCache('stats-test', { value: 42 });

    const stats = getCacheStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.entries[0].key).toBe('stats-test');
    expect(stats.entries[0].bytes).toBeGreaterThan(0);
    expect(stats.entries[0].ageMs).toBeGreaterThanOrEqual(0);
    expect(stats.entries[0].ageMs).toBeLessThan(1000); // Just written
  });

  it('sorts entries by size descending', () => {
    setCache('small', 'x');
    setCache('large', 'x'.repeat(500));
    setCache('medium', 'x'.repeat(100));

    const stats = getCacheStats();
    expect(stats.entries[0].key).toBe('large');
    expect(stats.entries[1].key).toBe('medium');
    expect(stats.entries[2].key).toBe('small');
  });

  it('totalBytes is sum of all entry bytes', () => {
    setCache('one', 'data1');
    setCache('two', 'data2');

    const stats = getCacheStats();
    const summedBytes = stats.entries.reduce((sum, e) => sum + e.bytes, 0);
    expect(stats.totalBytes).toBe(summedBytes);
  });
});
