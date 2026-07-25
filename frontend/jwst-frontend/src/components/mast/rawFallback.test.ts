/**
 * Offering raw data as a fallback (#1760) — the decision that closes the loop
 * between Discover and the calibration pipeline.
 */

import { describe, expect, it } from 'vitest';
import { SPARSE_L3_THRESHOLD, rawFallbackOffer } from './rawFallback';

const ctx = (over: Partial<Parameters<typeof rawFallbackOffer>[0]> = {}) => ({
  level3Only: true,
  resultCount: 0,
  hasSearched: true,
  ...over,
});

describe('rawFallbackOffer', () => {
  it('offers raw data when a target has no finished image', () => {
    const offer = rawFallbackOffer(ctx({ resultCount: 0 }));
    expect(offer?.headline).toMatch(/No finished images/);
    // Says what you would DO with it — the missing "why" is the whole bug.
    expect(offer?.detail).toMatch(/run the official JWST pipeline/i);
  });

  it('offers raw data when there is barely anything published', () => {
    expect(rawFallbackOffer(ctx({ resultCount: 1 }))?.headline).toMatch(/Only one/);
    expect(rawFallbackOffer(ctx({ resultCount: 2 }))?.headline).toMatch(/Only 2/);
  });

  it('stays quiet when there are plenty of finished images', () => {
    // Level 3 is the default because people want the best version already
    // made; pointing at hours of processing here would be bad advice.
    expect(rawFallbackOffer(ctx({ resultCount: SPARSE_L3_THRESHOLD + 1 }))).toBeNull();
    expect(rawFallbackOffer(ctx({ resultCount: 50 }))).toBeNull();
  });

  it('stays quiet when raw levels are already included', () => {
    // The results ARE the raw data — offering it again is noise.
    expect(rawFallbackOffer(ctx({ level3Only: false, resultCount: 0 }))).toBeNull();
  });

  it('stays quiet before the first search', () => {
    // An empty page is not evidence that a target lacks finished images.
    expect(rawFallbackOffer(ctx({ hasSearched: false }))).toBeNull();
  });
});
