/**
 * Instrument colours for canvas drawing (MAST Search v2 Phase 5).
 *
 * The chips and badges colour instruments through the `--instrument-*`
 * tokens in `index.css` (MIRI red, NIRCam blue, NIRISS green, NIRSpec
 * amber). Aladin draws on a canvas and needs literal colour strings, so
 * the tokens are read from the document at runtime — the map always
 * matches the chips, even if the palette changes. The hex fallbacks are
 * the token values at the time of writing, for environments without a
 * stylesheet (tests, SSR).
 */

import { normalizeInstrument } from '../../../utils/instrumentDisplay';

const TOKEN_BY_INSTRUMENT: Record<string, string> = {
  MIRI: '--instrument-miri',
  NIRCam: '--instrument-nircam',
  NIRISS: '--instrument-niriss',
  NIRSpec: '--instrument-nirspec',
};

const FALLBACK_BY_TOKEN: Record<string, string> = {
  '--instrument-miri': '#f87171',
  '--instrument-nircam': '#60a5fa',
  '--instrument-niriss': '#34d399',
  '--instrument-nirspec': '#fbbf24',
  '--instrument-default': '#a78bfa',
  '--accent-primary': '#3b82f6',
  '--accent-aqua': '#4cc9f0',
  '--text-primary': '#e8eaed',
};

const cache = new Map<string, string>();

/** Read a CSS custom property from `:root`, with a hex fallback. */
export function cssToken(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  let value: string;
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    value = '';
  }
  const resolved = value || FALLBACK_BY_TOKEN[name] || '#ffffff';
  cache.set(name, resolved);
  return resolved;
}

/** Tests: forget cached token values. */
export function resetTokenCache(): void {
  cache.clear();
}

/** Colour for a raw MAST instrument string (`"NIRCAM/IMAGE"` → NIRCam blue). */
export function instrumentColor(raw: string | undefined | null): string {
  const token = raw ? TOKEN_BY_INSTRUMENT[normalizeInstrument(raw)] : undefined;
  return cssToken(token ?? '--instrument-default');
}

/** `rgba()` form of a hex colour for translucent fills. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
