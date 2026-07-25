/**
 * When to offer raw data as a fallback (#1760).
 *
 * Level 3 stays the default: people want the best version already made. But a
 * target with little or no L3 has no good answer under that default, and the
 * app used to say nothing — you got an empty result and no hint that the raw
 * exposures exist and can be processed yourself.
 *
 * That silence is why libraries end up 91% L3 with nothing the calibration
 * pipeline can work on: not because raw data was unwanted, but because there
 * was no reason given to want it.
 *
 * A pure decision so it can be tested without driving a MAST search.
 */

/** At or below this many finished images, raw data is worth offering. */
export const SPARSE_L3_THRESHOLD = 3;

export interface RawFallbackContext {
  /** Whether the search that just ran was restricted to Level 3. */
  level3Only: boolean;
  /** How many results came back. */
  resultCount: number;
  /** Whether a search has actually run — no offer before the first one. */
  hasSearched: boolean;
}

export interface RawFallbackOffer {
  headline: string;
  detail: string;
}

/**
 * The offer to show, or null.
 *
 * Null when a search hasn't run, when raw levels were already included (the
 * results ARE the raw data), or when there is a healthy set of finished images
 * — in which case pointing at hours of processing would be bad advice.
 */
export function rawFallbackOffer(context: RawFallbackContext): RawFallbackOffer | null {
  const { level3Only, resultCount, hasSearched } = context;
  if (!hasSearched || !level3Only) return null;
  if (resultCount > SPARSE_L3_THRESHOLD) return null;

  if (resultCount === 0) {
    return {
      headline: 'No finished images for this target',
      detail:
        'Nobody has published a combined image here yet — but the raw exposures are almost certainly in the archive. You can download those and run the official JWST pipeline on them yourself to make one.',
    };
  }
  return {
    headline:
      resultCount === 1
        ? 'Only one finished image for this target'
        : `Only ${resultCount} finished images for this target`,
    detail:
      'There may be more raw exposures than have been combined. Downloading those lets you build your own image — often deeper, or framed differently, than what is published.',
  };
}
