/**
 * Offering raw data as a fallback (#1760) — the decision that closes the loop
 * between Discover and the calibration pipeline.
 */

import { describe, expect, it } from 'vitest';
import { SPARSE_L3_MAX_RESULTS, rawFallbackOffer, type CompletedSearch } from './rawFallback';

const search = (over: Partial<CompletedSearch> = {}): CompletedSearch => ({
  level3Only: true,
  resultCount: 0,
  subject: 'target',
  ...over,
});

describe('rawFallbackOffer', () => {
  it('offers raw data when a target has no finished image', () => {
    const offer = rawFallbackOffer(search({ resultCount: 0 }));
    expect(offer?.headline).toBe('No finished images for this target');
    // Says what you would DO with it — the missing "why" is the whole bug.
    expect(offer?.detail).toMatch(/run the official JWST pipeline/i);
  });

  it('offers raw data when there is barely anything published', () => {
    expect(rawFallbackOffer(search({ resultCount: 1 }))?.headline).toMatch(/^Only one/);
    expect(rawFallbackOffer(search({ resultCount: 2 }))?.headline).toMatch(/^Only 2/);
  });

  it('names what was actually searched', () => {
    // "for this target" is wrong for a program or a coordinate cone, and a
    // program's L3 count says nothing about how many raw exposures exist.
    expect(rawFallbackOffer(search({ subject: 'program' }))?.headline).toMatch(/in this program$/);
    expect(rawFallbackOffer(search({ subject: 'coordinates' }))?.headline).toMatch(
      /at these coordinates$/
    );
  });

  it('stays quiet when there are plenty of finished images', () => {
    // Level 3 is the default because people want the best version already
    // made; pointing at hours of processing here would be bad advice.
    expect(rawFallbackOffer(search({ resultCount: SPARSE_L3_MAX_RESULTS + 1 }))).toBeNull();
    expect(rawFallbackOffer(search({ resultCount: 50 }))).toBeNull();
  });

  it('stays quiet when the results already include raw data', () => {
    // Offering it again would re-run the identical query — a visible dead end.
    expect(rawFallbackOffer(search({ level3Only: false }))).toBeNull();
  });

  it('stays quiet with no completed search', () => {
    // In flight, abandoned on a validation error, or failed: none of those are
    // evidence about what the archive holds, and the offer states a fact.
    expect(rawFallbackOffer(null)).toBeNull();
  });
});
