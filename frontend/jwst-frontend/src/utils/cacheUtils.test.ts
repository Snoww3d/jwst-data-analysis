import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCached, getStale, setCache, clearCacheByPrefix } from './cacheUtils';

// Mock localStorage
const mockStorage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, val),
  removeItem: (key: string) => mockStorage.delete(key),
  get length() {
    return mockStorage.size;
  },
  key: (i: number) => [...mockStorage.keys()][i] ?? null,
  clear: () => mockStorage.clear(),
});

beforeEach(() => {
  mockStorage.clear();
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
