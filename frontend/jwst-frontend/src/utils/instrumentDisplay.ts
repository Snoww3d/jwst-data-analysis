/**
 * Instrument display-name helpers — frontend mirror of the backend
 * `normalize_instrument_for_display` / `format_instruments_for_display` in
 * `processing-engine/app/discovery/recipe_engine.py`.
 *
 * The `instruments` field on recipes/targets is kept raw (e.g. `"NIRCAM/IMAGE"`)
 * because downstream consumers depend on the raw MAST form, so normalization
 * happens at the render site. Keep the map and ordering in sync with the backend
 * so card meta lines match auto-generated recipe titles. (#1561, follow-up to #1454)
 */

/** Canonical display names for JWST instruments. */
const INSTRUMENT_DISPLAY: Record<string, string> = {
  NIRCAM: 'NIRCam',
  NIRISS: 'NIRISS',
  NIRSPEC: 'NIRSpec',
  MIRI: 'MIRI',
  FGS: 'FGS',
};

/** Order cross-instrument names short → long wavelength (NIRCam … MIRI). */
const INSTRUMENT_DISPLAY_ORDER = ['NIRCam', 'NIRISS', 'NIRSpec', 'FGS', 'MIRI'];

/**
 * Convert a raw MAST instrument string (e.g. `"NIRCAM/IMAGE"`) into a clean
 * display name (e.g. `"NIRCam"`), dropping the dataproduct-kind suffix. Unknown
 * instruments fall back to a title-cased base.
 */
export function normalizeInstrument(raw: string): string {
  const base = raw.split('/', 1)[0].trim().toUpperCase();
  if (base in INSTRUMENT_DISPLAY) return INSTRUMENT_DISPLAY[base];
  // Title-case fallback: "NEWCAM" → "Newcam" (mirrors Python str.title()).
  return base.charAt(0) + base.slice(1).toLowerCase();
}

/**
 * Normalize, de-duplicate, and join instrument names for display, ordered short
 * → long wavelength (NIRCam … MIRI). Unrecognized names are appended in sorted
 * order for determinism.
 */
export function formatInstruments(raw: string[]): string {
  const seen = new Set(raw.map(normalizeInstrument));
  const ordered = INSTRUMENT_DISPLAY_ORDER.filter((d) => seen.has(d));
  const unknown = [...seen].filter((d) => !ordered.includes(d)).sort();
  return [...ordered, ...unknown].join(' + ');
}
