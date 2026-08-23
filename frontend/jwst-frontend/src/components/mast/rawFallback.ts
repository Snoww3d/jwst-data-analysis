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

/** At or below this many returned rows, raw data is worth offering. */
export const SPARSE_L3_MAX_RESULTS = 3;

/** What a search was for, so the offer can name it correctly. */
export type SearchSubject = 'target' | 'coordinates' | 'program' | 'observation' | 'facets';

const SUBJECT_PHRASE: Record<SearchSubject, string> = {
  target: 'for this target',
  coordinates: 'at these coordinates',
  program: 'in this program',
  observation: 'for this observation',
  facets: 'matching these filters',
};

/**
 * A COMPLETED search. Null elsewhere — a search that is still running, was
 * abandoned on a validation error, or failed outright is not evidence about
 * what the archive holds, and the offer states a fact about the archive.
 */
export interface CompletedSearch {
  /** Whether the results on screen are restricted to Level 3. */
  level3Only: boolean;
  resultCount: number;
  subject: SearchSubject;
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
export function rawFallbackOffer(search: CompletedSearch | null): RawFallbackOffer | null {
  if (!search) return null;
  const { level3Only, resultCount, subject } = search;
  if (!level3Only) return null;
  if (resultCount > SPARSE_L3_MAX_RESULTS) return null;

  const where = SUBJECT_PHRASE[subject];
  if (resultCount === 0) {
    return {
      headline: `No finished images ${where}`,
      detail:
        'Nobody has published a combined image here yet — but the raw exposures are almost certainly in the archive. You can download those and run the official JWST pipeline on them yourself to make one.',
    };
  }
  return {
    headline:
      resultCount === 1
        ? `Only one finished image ${where}`
        : `Only ${resultCount} finished images ${where}`,
    detail:
      'There may be more raw exposures than have been combined. Downloading those lets you build your own image — often deeper, or framed differently, than what is published.',
  };
}
