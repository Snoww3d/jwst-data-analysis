/**
 * STC-S footprint parsing for MAST `s_region` strings (MAST Search v2 Phase 5).
 *
 * Aladin draws footprints from the raw string (`A.footprintsFromSTCS`); this
 * parser serves everything that is LOGIC — bounds for "fit to results",
 * centroids for "go to", and Phase 6's client-side clipping — so no geometry
 * depends on Aladin's internals.
 *
 * Real JWST rows are bare 4-vertex polygons with no frame token, e.g.
 *   "POLYGON 151.7538 -40.4086 151.7925 -40.4290 151.7524 -40.4729 151.7137 -40.4524"
 * That is the fast path. The tolerant path accepts what other collections
 * emit: an optional frame token (`ICRS` | `J2000` | `FK5` | `GALACTIC` —
 * recorded, not transformed), `CIRCLE [frame] ra dec r` (→ a 32-gon),
 * `UNION ( … )` and concatenated polygons, any case, nested parentheses.
 * `NOT`, `BOX`, `ELLIPSE`, `INTERSECTION` and unknown words are skipped and
 * counted in `parseStcsDetailed`.
 */

export interface SkyPoint {
  ra: number;
  dec: number;
}

/** One closed polygon, vertices in degrees (ICRS unless the source said otherwise). */
export type SkyPolygon = SkyPoint[];

export interface StcsParseResult {
  polygons: SkyPolygon[];
  /** Shapes/words that were recognised as STC-S but not rendered (NOT, BOX, unknown…). */
  ignored: number;
}

export interface SkyBounds {
  /** Minimum RA of the footprints, in [0, 360). May be > `raMax` when the set wraps RA=0. */
  raMin: number;
  raMax: number;
  decMin: number;
  decMax: number;
  /** Angular width in RA degrees (wrap-aware; not cos(dec)-scaled). */
  raSpan: number;
  decSpan: number;
}

const FRAME_TOKENS = new Set(['ICRS', 'J2000', 'FK5', 'FK4', 'GALACTIC', 'ECLIPTIC']);
const CIRCLE_SEGMENTS = 32;
const DEG = Math.PI / 180;

/** Fast path: bare `POLYGON` followed by an even run of ≥6 numbers and nothing else. */
const BARE_POLYGON_RE = /^\s*POLYGON\s+((?:[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?\s*){6,})$/i;
const NUMBER_RE = /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i;

function normaliseRa(ra: number): number {
  let r = ra % 360;
  if (r < 0) r += 360;
  // -1e-12 lands at 359.999…; that is RA 0 for every purpose here.
  return r >= 360 - 1e-9 ? 0 : r;
}

function toPolygon(nums: number[]): SkyPolygon | null {
  if (nums.length < 6 || nums.length % 2 !== 0) return null;
  const poly: SkyPolygon = [];
  for (let i = 0; i < nums.length; i += 2) {
    const ra = nums[i];
    const dec = nums[i + 1];
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) return null;
    poly.push({ ra: normaliseRa(ra), dec });
  }
  return poly;
}

/** A small circle on the sphere as a polygon, built from a local tangent frame. */
export function circleToPolygon(
  ra: number,
  dec: number,
  radius: number,
  segments = CIRCLE_SEGMENTS
): SkyPolygon {
  const poly: SkyPolygon = [];
  const ra0 = ra * DEG;
  const dec0 = dec * DEG;
  const r = radius * DEG;
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    // Position angle `theta` at angular distance `r` from (ra0, dec0).
    const sinDec = Math.sin(dec0) * Math.cos(r) + Math.cos(dec0) * Math.sin(r) * Math.cos(theta);
    const decI = Math.asin(Math.max(-1, Math.min(1, sinDec)));
    const y = Math.sin(theta) * Math.sin(r) * Math.cos(dec0);
    const x = Math.cos(r) - Math.sin(dec0) * Math.sin(decI);
    const raI = ra0 + Math.atan2(y, x);
    poly.push({ ra: normaliseRa(raI / DEG), dec: decI / DEG });
  }
  return poly;
}

/**
 * Parse an `s_region` string; unknown or malformed input yields no polygons
 * and never throws. Use `parseStcsDetailed` to learn what was skipped.
 */
export function parseStcs(sRegion: string | null | undefined): SkyPolygon[] {
  return parseStcsDetailed(sRegion).polygons;
}

export function parseStcsDetailed(sRegion: string | null | undefined): StcsParseResult {
  if (typeof sRegion !== 'string') return { polygons: [], ignored: 0 };
  const text = sRegion.trim();
  if (!text) return { polygons: [], ignored: 0 };

  const fast = BARE_POLYGON_RE.exec(text);
  if (fast) {
    const nums = fast[1].trim().split(/\s+/).map(Number);
    const poly = toPolygon(nums);
    return { polygons: poly ? [poly] : [], ignored: 0 };
  }

  // Tolerant path: tokenise, treating parentheses as whitespace (UNION (...)
  // / nested groups carry no meaning for a flat list of drawable shapes).
  const tokens = text.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const polygons: SkyPolygon[] = [];
  let ignored = 0;
  let i = 0;

  const skipFrame = () => {
    if (i < tokens.length && FRAME_TOKENS.has(tokens[i].toUpperCase())) i++;
  };
  const readNumbers = (): number[] => {
    const nums: number[] = [];
    while (i < tokens.length && NUMBER_RE.test(tokens[i])) {
      nums.push(Number(tokens[i]));
      i++;
    }
    return nums;
  };

  while (i < tokens.length) {
    const word = tokens[i].toUpperCase();
    i++;
    if (word === 'POLYGON') {
      skipFrame();
      const poly = toPolygon(readNumbers());
      if (poly) polygons.push(poly);
      else ignored++;
    } else if (word === 'CIRCLE') {
      skipFrame();
      const nums = readNumbers();
      if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite) && nums[2] > 0) {
        polygons.push(circleToPolygon(nums[0], nums[1], nums[2]));
      } else {
        ignored++;
      }
    } else if (word === 'UNION' || word === 'INTERSECTION') {
      // Grouping words — their member shapes follow and are parsed on their own.
    } else if (word === 'NOT') {
      // `NOT <shape>` excludes an area: not drawable as a footprint, so the
      // operand shape is swallowed with it.
      ignored++;
      if (i < tokens.length && !NUMBER_RE.test(tokens[i])) i++;
      skipFrame();
      readNumbers();
    } else if (NUMBER_RE.test(word) || FRAME_TOKENS.has(word)) {
      // Stray number/frame outside a shape (e.g. after an unknown shape): skip.
    } else {
      // BOX, ELLIPSE, DIFFERENCE, garbage…
      ignored++;
      skipFrame();
      readNumbers();
    }
  }
  return { polygons, ignored };
}

/** Unit vector for a sky position. */
function toVector(p: SkyPoint): [number, number, number] {
  const ra = p.ra * DEG;
  const dec = p.dec * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/**
 * Centroid of a set of polygons via the mean unit vector — well-defined
 * across RA=0 and near the poles. `null` for an empty set.
 */
export function footprintCentroid(polys: readonly SkyPolygon[]): SkyPoint | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const poly of polys) {
    for (const p of poly) {
      const [vx, vy, vz] = toVector(p);
      x += vx;
      y += vy;
      z += vz;
      n++;
    }
  }
  if (n === 0) return null;
  const norm = Math.hypot(x, y, z);
  if (norm === 0) return null;
  const ra = normaliseRa(Math.atan2(y, x) / DEG);
  const dec = Math.asin(Math.max(-1, Math.min(1, z / norm))) / DEG;
  return { ra, dec };
}

/**
 * RA/Dec bounds of a set of polygons, wrap-aware in RA: the RA interval is
 * the smallest arc that contains every vertex, so footprints straddling
 * RA=0 get `raMin` ≈ 359.x and `raMax` ≈ 0.x with a small `raSpan`.
 * `null` for an empty set.
 */
export function footprintBounds(polys: readonly SkyPolygon[]): SkyBounds | null {
  const ras: number[] = [];
  let decMin = Infinity;
  let decMax = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      ras.push(normaliseRa(p.ra));
      if (p.dec < decMin) decMin = p.dec;
      if (p.dec > decMax) decMax = p.dec;
    }
  }
  if (ras.length === 0) return null;
  ras.sort((a, b) => a - b);
  // The largest gap between consecutive RAs (circularly) is the part of the
  // circle NOT covered; the bounds are its complement.
  let gapStart = ras[ras.length - 1];
  let gapEnd = ras[0] + 360;
  let maxGap = gapEnd - gapStart;
  for (let k = 1; k < ras.length; k++) {
    const gap = ras[k] - ras[k - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapStart = ras[k - 1];
      gapEnd = ras[k];
    }
  }
  const raMin = normaliseRa(gapEnd);
  const raMax = normaliseRa(gapStart);
  const raSpan = ras.length === 1 ? 0 : 360 - maxGap;
  return { raMin, raMax, decMin, decMax, raSpan, decSpan: decMax - decMin };
}

/**
 * A field of view (degrees) that shows the whole set with some margin:
 * the larger of the dec span and the cos(dec)-scaled RA span, times 1.5,
 * clamped to a sensible range for Aladin.
 */
export function fovForBounds(bounds: SkyBounds, minFov = 0.05, maxFov = 180): number {
  const midDec = (bounds.decMin + bounds.decMax) / 2;
  const raExtent = bounds.raSpan * Math.max(Math.cos(midDec * DEG), 0.05);
  const extent = Math.max(raExtent, bounds.decSpan);
  return Math.min(maxFov, Math.max(minFov, extent * 1.5));
}
