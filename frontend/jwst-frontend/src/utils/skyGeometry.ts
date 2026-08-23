/**
 * Drawn-region geometry for draw-to-search (MAST Search v2 Phase 6).
 *
 * A drawn shape (circle or polygon on the sky) becomes a bounding circle for
 * the server bbox query (`mode:'box'`), and the response is clipped client-
 * side: a row is kept when any of its `s_region` footprint polygons
 * intersects the shape.
 *
 * Intersection is NEVER tested in raw (ra, dec) space — RA wraps at 0 and
 * degrees of RA shrink towards the poles. Both shapes are projected onto the
 * tangent plane at the drawn shape's centroid (gnomonic, via unit vectors)
 * and tested with planar geometry. The scale error of the gnomonic
 * projection is ≈ tan θ/θ − 1 (0.4% at 5°, 1.6% at 10°) — far below a
 * footprint width, so hit-testing is effectively exact. Shapes larger than
 * `MAX_REGION_RADIUS_DEG` are rejected before any query.
 */

import { parseStcs, type SkyPoint, type SkyPolygon } from '../components/mast/map/footprints';

export type SkyRegion =
  | { kind: 'circle'; ra: number; dec: number; /** radius, degrees */ r: number }
  | { kind: 'polygon'; vertices: SkyPolygon };

/** Backend max cone/box radius (degrees); also the region size gate. */
export const MAX_REGION_RADIUS_DEG = 10;
/** URL vertex cap; denser polygons are evenly downsampled to this. */
export const MAX_REGION_VERTICES = 50;

const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

function toVector(p: SkyPoint): Vec3 {
  const ra = p.ra * DEG;
  const dec = p.dec * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

function fromVector(v: Vec3): SkyPoint {
  const norm = Math.hypot(v[0], v[1], v[2]);
  let ra = Math.atan2(v[1], v[0]) / DEG;
  if (ra < 0) ra += 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, v[2] / norm))) / DEG;
  return { ra, dec };
}

/** Angular separation between two sky positions, degrees. */
export function angularSeparation(a: SkyPoint, b: SkyPoint): number {
  const va = toVector(a);
  const vb = toVector(b);
  const dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

export interface BoundingCircle {
  ra: number;
  dec: number;
  /** radius, degrees — clamped to `MAX_REGION_RADIUS_DEG`. */
  radius: number;
}

/**
 * The smallest practical circle around a region: unit-vector mean centroid,
 * radius = max angular separation to a vertex (for a circle, its own
 * radius). Clamped to the backend max. `null` for a degenerate polygon.
 */
export function boundingCircle(region: SkyRegion): BoundingCircle | null {
  if (region.kind === 'circle') {
    return {
      ra: region.ra,
      dec: region.dec,
      radius: Math.min(region.r, MAX_REGION_RADIUS_DEG),
    };
  }
  if (region.vertices.length < 3) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of region.vertices) {
    const [vx, vy, vz] = toVector(p);
    x += vx;
    y += vy;
    z += vz;
  }
  if (Math.hypot(x, y, z) === 0) return null;
  const centre = fromVector([x, y, z]);
  let radius = 0;
  for (const p of region.vertices) {
    const sep = angularSeparation(centre, p);
    if (sep > radius) radius = sep;
  }
  return { ra: centre.ra, dec: centre.dec, radius: Math.min(radius, MAX_REGION_RADIUS_DEG) };
}

/**
 * True when the drawn shape is too large to search (bounding radius beyond
 * the backend max BEFORE clamping) — reject with "Draw a smaller region".
 */
export function regionTooLarge(region: SkyRegion): boolean {
  if (region.kind === 'circle') return region.r > MAX_REGION_RADIUS_DEG;
  if (region.vertices.length < 3) return false;
  const bc = boundingCircle(region);
  if (!bc) return false;
  // boundingCircle clamps; re-derive the unclamped max separation.
  const centre = { ra: bc.ra, dec: bc.dec };
  return region.vertices.some((p) => angularSeparation(centre, p) > MAX_REGION_RADIUS_DEG);
}

// ---------------------------------------------------------------------------
// Gnomonic projection + planar intersection
// ---------------------------------------------------------------------------

interface Plane {
  /** Project a sky point onto the tangent plane at the centre; radians. */
  project(p: SkyPoint): [number, number] | null;
}

/** Tangent plane at `centre`; points more than 90° away do not project. */
function gnomonicPlane(centre: SkyPoint): Plane {
  const ra0 = centre.ra * DEG;
  const dec0 = centre.dec * DEG;
  const sinDec0 = Math.sin(dec0);
  const cosDec0 = Math.cos(dec0);
  return {
    project(p: SkyPoint): [number, number] | null {
      const ra = p.ra * DEG;
      const dec = p.dec * DEG;
      const sinDec = Math.sin(dec);
      const cosDec = Math.cos(dec);
      const cosDra = Math.cos(ra - ra0);
      const cosC = sinDec0 * sinDec + cosDec0 * cosDec * cosDra;
      if (cosC <= 1e-9) return null; // behind the tangent plane
      const x = (cosDec * Math.sin(ra - ra0)) / cosC;
      const y = (cosDec0 * sinDec - sinDec0 * cosDec * cosDra) / cosC;
      return [x, y];
    },
  };
}

type Pt = [number, number];

function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (o: Pt, p: Pt, q: Pt) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return true;
  const onSeg = (o: Pt, p: Pt, q: Pt) =>
    Math.min(o[0], p[0]) <= q[0] &&
    q[0] <= Math.max(o[0], p[0]) &&
    Math.min(o[1], p[1]) <= q[1] &&
    q[1] <= Math.max(o[1], p[1]);
  if (d1 === 0 && onSeg(c, d, a)) return true;
  if (d2 === 0 && onSeg(c, d, b)) return true;
  if (d3 === 0 && onSeg(a, b, c)) return true;
  if (d4 === 0 && onSeg(a, b, d)) return true;
  return false;
}

function polygonsIntersectPlanar(a: Pt[], b: Pt[]): boolean {
  // Any edge crossing…
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  // …or full containment either way.
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function circleIntersectsPolygonPlanar(centre: Pt, r: number, poly: Pt[]): boolean {
  // Centre inside the polygon…
  if (pointInPolygon(centre, poly)) return true;
  // …or a vertex within r, or an edge passing within r.
  for (let i = 0; i < poly.length; i++) {
    if (pointToSegmentDistance(centre, poly[i], poly[(i + 1) % poly.length]) <= r) return true;
  }
  return false;
}

/**
 * Does a footprint polygon (sky coordinates) intersect the drawn region?
 * Both are projected onto the tangent plane at the region's centroid; a
 * footprint entirely behind that plane (> 90° away) cannot intersect a
 * region that is at most 10° across, so it is a miss.
 */
export function footprintIntersectsRegion(footprint: SkyPolygon, region: SkyRegion): boolean {
  const bc = boundingCircle(region);
  if (!bc || footprint.length < 3) return false;
  const plane = gnomonicPlane({ ra: bc.ra, dec: bc.dec });

  const projected: Pt[] = [];
  for (const p of footprint) {
    const pt = plane.project(p);
    if (!pt) return false;
    projected.push(pt);
  }

  if (region.kind === 'circle') {
    // The projected circle centre is the plane origin; the radius maps to
    // tan(r) (gnomonic radial scale from the tangent point).
    return circleIntersectsPolygonPlanar([0, 0], Math.tan(region.r * DEG), projected);
  }

  const regionPts: Pt[] = [];
  for (const p of region.vertices) {
    const pt = plane.project(p);
    if (!pt) return false; // cannot happen for a valid ≤10° region
    regionPts.push(pt);
  }
  return polygonsIntersectPlanar(regionPts, projected);
}

export interface ClipResult<Row> {
  rows: Row[];
  /** Rows kept because their `s_region` yielded no usable polygons. */
  unclippable: number;
}

/**
 * Keep the rows whose footprint intersects the drawn region. A row whose
 * `s_region` cannot be parsed into any polygon is KEPT (it cannot be
 * disproved) and counted in `unclippable`.
 */
export function clipResults<Row extends { s_region?: string }>(
  rows: readonly Row[],
  region: SkyRegion
): ClipResult<Row> {
  const kept: Row[] = [];
  let unclippable = 0;
  for (const row of rows) {
    const polys = parseStcs(row.s_region);
    if (polys.length === 0) {
      unclippable++;
      kept.push(row);
      continue;
    }
    if (polys.some((poly) => footprintIntersectsRegion(poly, region))) kept.push(row);
  }
  return { rows: kept, unclippable };
}

// ---------------------------------------------------------------------------
// URL round-trip + labels
// ---------------------------------------------------------------------------

const round4 = (n: number) => Number(n.toFixed(4));
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/** RA into [0, 360) — Aladin's `pix2world` can return negative RA. */
function normaliseRa(ra: number): number {
  let r = ra % 360;
  if (r < 0) r += 360;
  return r >= 360 ? 0 : r;
}

/** Round to 4 dp, then normalise (359.99998 rounds to 360, which is RA 0). */
const urlRa = (ra: number) => normaliseRa(round4(ra));

/** Even downsample to at most `max` vertices, endpoints preserved. */
export function downsampleVertices(vertices: SkyPolygon, max = MAX_REGION_VERTICES): SkyPolygon {
  if (vertices.length <= max) return vertices;
  const out: SkyPolygon = [];
  for (let i = 0; i < max; i++) {
    out.push(vertices[Math.floor((i * vertices.length) / max)]);
  }
  return out;
}

/** `circle:ra,dec,r` / `poly:ra,dec;ra,dec;…` — 4 dp. */
export function serializeRegion(region: SkyRegion): string {
  if (region.kind === 'circle') {
    return `circle:${urlRa(region.ra)},${round4(region.dec)},${round4(region.r)}`;
  }
  const verts = downsampleVertices(region.vertices)
    .map((p) => `${urlRa(p.ra)},${round4(p.dec)}`)
    .join(';');
  return `poly:${verts}`;
}

/** Parse a `region=` URL value; anything unusable → `null`. */
export function parseRegionParam(value: string | null | undefined): SkyRegion | null {
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep < 0) return null;
  const kind = value.slice(0, sep);
  const body = value.slice(sep + 1);
  const num = (s: string): number | null => (NUM_RE.test(s) ? Number(s) : null);
  if (kind === 'circle') {
    const parts = body.split(',');
    if (parts.length !== 3) return null;
    const ra = num(parts[0]);
    const dec = num(parts[1]);
    const r = num(parts[2]);
    if (ra === null || dec === null || r === null) return null;
    if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
    if (r < 0.001 || r > MAX_REGION_RADIUS_DEG) return null;
    return { kind: 'circle', ra, dec, r };
  }
  if (kind === 'poly') {
    const pairs = body.split(';');
    if (pairs.length < 3 || pairs.length > MAX_REGION_VERTICES) return null;
    const vertices: SkyPolygon = [];
    for (const pair of pairs) {
      const parts = pair.split(',');
      if (parts.length !== 2) return null;
      const ra = num(parts[0]);
      const dec = num(parts[1]);
      if (ra === null || dec === null || ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
      vertices.push({ ra, dec });
    }
    const region: SkyRegion = { kind: 'polygon', vertices };
    return regionTooLarge(region) ? null : region;
  }
  return null;
}

/** Toolbar-chip label, e.g. `POLYGON · 5 VTX (≈0.6°)` / `CIRCLE · R 0.50°`. */
export function describeRegion(region: SkyRegion): string {
  if (region.kind === 'circle') return `CIRCLE · R ${region.r.toFixed(2)}°`;
  const bc = boundingCircle(region);
  const size = bc ? ` (≈${(bc.radius * 2).toFixed(1)}°)` : '';
  return `POLYGON · ${region.vertices.length} VTX${size}`;
}
