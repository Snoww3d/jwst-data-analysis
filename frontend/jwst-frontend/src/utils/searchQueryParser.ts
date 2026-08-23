import { parseSexagesimal } from './coordinateUtils';

/**
 * What a free-text MAST search string means. The smart search input parses
 * on every keystroke and shows the interpretation; MastSearch maps the
 * result onto the four existing endpoints.
 */
export type ParsedQuery =
  | { kind: 'obsId'; obsId: string }
  | { kind: 'program'; programId: string }
  | { kind: 'coords'; ra: number; dec: number }
  | { kind: 'target'; name: string };

// JWST observation IDs start `jw` + 5-digit program, then only the
// characters the backend accepts (`_SAFE_OBS_ID_PATTERN`,
// processing-engine/app/mast/models.py) — e.g. jw02739-o001_t001_nircam_clear-f090w.
const OBS_ID_RE = /^jw\d{5}[a-z0-9._-]*$/i;

// `2739`, `#2739`, `PID 2739`, `program 2739`, `prop 2739`, `proposal #2739`.
const PROGRAM_RE = /^(?:pid|program|prop(?:osal)?)?\s*#?\s*(\d{3,5})$/i;

const DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Split a coordinate-looking string into its RA and Dec halves, or null when
 * there is no sensible split. Tried in order: an explicit comma; a signed
 * second half (`10h 37m -58°`, `159.25 +12`); an even number of whitespace
 * tokens split down the middle (`10 37 12 58 12 34`, `159.25 58`).
 */
function splitRaDec(s: string): [string, string] | null {
  const comma = s.indexOf(',');
  if (comma >= 0) {
    const ra = s.slice(0, comma).trim();
    const dec = s.slice(comma + 1).trim();
    return ra && dec ? [ra, dec] : null;
  }
  const signed = /^(.*?\S)\s+([+-].*)$/.exec(s);
  if (signed) return [signed[1], signed[2]];
  const tokens = s.split(/\s+/);
  if (tokens.length >= 2 && tokens.length <= 6 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    return [tokens.slice(0, half).join(' '), tokens.slice(half).join(' ')];
  }
  return null;
}

function parseCoords(s: string): { ra: number; dec: number } | null {
  const halves = splitRaDec(s);
  if (!halves) return null;
  const [raStr, decStr] = halves;

  // Two bare numbers are decimal degrees; anything with h/m/s, colons, or
  // multiple parts is sexagesimal (RA in hours).
  if (DECIMAL_RE.test(raStr) && DECIMAL_RE.test(decStr)) {
    const ra = parseFloat(raStr);
    const dec = parseFloat(decStr);
    if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
    return { ra, dec };
  }
  return parseSexagesimal(raStr, decStr);
}

/**
 * Classify a raw search string. Order matters: observation IDs and program
 * IDs are unambiguous prefixes/shapes, coordinates need two parseable
 * halves, and everything else is a target name for MAST's resolver.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  // U+2212 MINUS SIGN → '-' so pasted "−58°" declinations parse.
  const s = raw.trim().replace(/−/g, '-');
  if (!s) return { kind: 'target', name: '' };

  if (OBS_ID_RE.test(s)) return { kind: 'obsId', obsId: s };

  const program = PROGRAM_RE.exec(s);
  if (program) return { kind: 'program', programId: program[1] };

  const coords = parseCoords(s);
  if (coords) return { kind: 'coords', ra: coords.ra, dec: coords.dec };

  return { kind: 'target', name: s };
}

/** Degrees for the hint: up to 4 decimals, at least 2, typographic minus. */
function formatDegrees(value: number): string {
  const fixed = value.toFixed(4).replace(/(\.\d\d)0+$/, '$1');
  return (value < 0 ? '−' : '') + fixed.replace('-', '') + '°';
}

/**
 * The human-readable "Interpreted as: …" line shown beneath the smart input.
 * Empty string for an empty query so the caller can show its own prompt.
 */
export function describeParsedQuery(parsed: ParsedQuery): string {
  switch (parsed.kind) {
    case 'obsId':
      return `Interpreted as: observation ID ${parsed.obsId}`;
    case 'program':
      return `Interpreted as: program ${parsed.programId}`;
    case 'coords':
      return `Interpreted as: coordinates ${formatDegrees(parsed.ra)}, ${formatDegrees(parsed.dec)}`;
    case 'target':
      return parsed.name ? `Interpreted as: target name "${parsed.name}"` : '';
  }
}
