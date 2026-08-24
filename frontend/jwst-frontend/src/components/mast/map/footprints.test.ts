import { describe, expect, it } from 'vitest';
import {
  circleToPolygon,
  footprintBounds,
  footprintCentroid,
  fovForBounds,
  parseStcs,
  parseStcsDetailed,
} from './footprints';

/** Verbatim `s_region` from a real JWST Level-3 row (MIRI, Carina). */
const REAL_FIXTURE =
  'POLYGON 151.7538 -40.4086 151.7925 -40.4290 151.7524 -40.4729 151.7137 -40.4524';

describe('parseStcs', () => {
  it('parses the real bare 4-vertex JWST polygon (fast path)', () => {
    const polys = parseStcs(REAL_FIXTURE);
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(4);
    expect(polys[0][0]).toEqual({ ra: 151.7538, dec: -40.4086 });
    expect(polys[0][3]).toEqual({ ra: 151.7137, dec: -40.4524 });
  });

  it('accepts a frame token without transforming the coordinates', () => {
    const polys = parseStcs('POLYGON ICRS 10 20 11 20 11 21 10 21');
    expect(polys).toEqual([
      [
        { ra: 10, dec: 20 },
        { ra: 11, dec: 20 },
        { ra: 11, dec: 21 },
        { ra: 10, dec: 21 },
      ],
    ]);
    expect(parseStcs('POLYGON J2000 10 20 11 20 11 21')).toHaveLength(1);
    expect(parseStcs('POLYGON FK5 10 20 11 20 11 21')).toHaveLength(1);
  });

  it('parses a UNION of four polygons (mosaic tiles)', () => {
    const tile = (dx: number) =>
      `POLYGON ${10 + dx} 0 ${10.1 + dx} 0 ${10.1 + dx} 0.1 ${10 + dx} 0.1`;
    const s = `UNION (${tile(0)} ${tile(0.1)} ${tile(0.2)} ${tile(0.3)})`;
    const polys = parseStcs(s);
    expect(polys).toHaveLength(4);
    expect(polys[3][0]).toEqual({ ra: 10.3, dec: 0 });
  });

  it('parses concatenated polygons without UNION', () => {
    const polys = parseStcs('POLYGON 0 0 1 0 1 1 POLYGON 5 5 6 5 6 6 5 6');
    expect(polys).toHaveLength(2);
    expect(polys[1]).toHaveLength(4);
  });

  // Verbatim `s_region` of jw08277-o041_t026_nircam_clear-f277w, a real NIRCam
  // mosaic returned by a Stephan's Quintet region search: two POLYGONs, 68
  // numbers, 927 chars. The old fast-path regex used `\s*` between numbers, so
  // this string matched `POLYGON`, consumed numbers, hit the second literal
  // `POLYGON`, failed the `$` anchor, and then backtracked over every way of
  // partitioning ~400 characters of digits — hanging the tab permanently.
  const MOSAIC_MULTIPOLYGON =
    'POLYGON 339.156558461 34.425372185 339.153570232 34.389316269 339.153525007 34.389318454 ' +
    '339.153387099 34.387660709 339.153386864 34.387657872 339.110556414 34.389720135 ' +
    '339.110559122 34.38977075 339.108545158 34.38986735 339.108545383 34.389871561 339.108543788 ' +
    '34.389871638 339.110461044 34.425711682 339.110554029 34.425707789 339.110643005 ' +
    '34.427370267 339.154544358 34.425524426 339.154544196 34.425521003 339.15453893 34.425457475 ' +
    'POLYGON 339.2154864 34.42177575 339.215407165 34.420624395 339.212438278 34.385936844 ' +
    '339.212396363 34.385938784 339.212254003 34.384281478 339.212253746 34.384278476 ' +
    '339.196754017 34.384994769 339.169357454 34.386271018 339.169359728 34.386311809 ' +
    '339.167345555 34.386404293 339.167345792 34.386408542 339.167344191 34.386408615 ' +
    '339.169360446 34.422568549 339.169450785 34.422563839 339.169543568 34.424227035 ' +
    '339.213491753 34.421927906 339.213491594 34.421924543 339.213487839 34.421880679';

  it('parses a real two-POLYGON mosaic footprint', () => {
    const polys = parseStcs(MOSAIC_MULTIPOLYGON);
    expect(polys).toHaveLength(2);
    expect(polys[0].length).toBeGreaterThanOrEqual(3);
    expect(polys[1].length).toBeGreaterThanOrEqual(3);
  });

  it('does not backtrack catastrophically on multi-polygon input', () => {
    const start = Date.now();
    parseStcs(MOSAIC_MULTIPOLYGON);
    expect(Date.now() - start).toBeLessThan(250);
  });

  it('stays linear when a long numeric run fails the fast path', () => {
    // Doubling the numbers must not square the time. Unbounded backtracking
    // made this hang outright, so any sane bound proves the fix.
    const build = (n: number) =>
      `POLYGON ${Array.from({ length: n }, (_, i) => `339.29404620${i % 10}`).join(' ')} POLYGON 1 2 3 4 5 6`;
    const start = Date.now();
    parseStcs(build(200));
    expect(Date.now() - start).toBeLessThan(250);
  });

  it('turns a CIRCLE into a 32-gon around the centre', () => {
    const polys = parseStcs('CIRCLE ICRS 180 45 0.5');
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(32);
    const c = footprintCentroid(polys)!;
    expect(c.ra).toBeCloseTo(180, 3);
    expect(c.dec).toBeCloseTo(45, 3);
    // every vertex is ~0.5° from the centre (dec offset at the top/bottom)
    const top = polys[0][0];
    expect(top.dec).toBeCloseTo(45.5, 5);
  });

  it('is case-insensitive', () => {
    expect(parseStcs('polygon icrs 1 1 2 1 2 2')).toHaveLength(1);
    expect(parseStcs('Circle 10 10 1')).toHaveLength(1);
    expect(parseStcs('union (polygon 1 1 2 1 2 2 polygon 3 3 4 3 4 4)')).toHaveLength(2);
  });

  it('returns [] for garbage, empty, null and undefined', () => {
    expect(parseStcs('hello world')).toEqual([]);
    expect(parseStcs('')).toEqual([]);
    expect(parseStcs('   ')).toEqual([]);
    expect(parseStcs(null)).toEqual([]);
    expect(parseStcs(undefined)).toEqual([]);
    expect(parseStcs('POLYGON')).toEqual([]);
    expect(parseStcs('POLYGON a b c d e f')).toEqual([]);
  });

  it('drops a polygon with an odd coordinate count', () => {
    expect(parseStcs('POLYGON 1 1 2 1 2')).toEqual([]);
    expect(parseStcs('POLYGON 1 1 2 1 2 2 3')).toEqual([]);
  });

  it('drops a polygon with fewer than three vertices', () => {
    expect(parseStcs('POLYGON 1 1 2 2')).toEqual([]);
    expect(parseStcs('POLYGON 1 1')).toEqual([]);
  });

  it('rejects out-of-range declinations', () => {
    expect(parseStcs('POLYGON 1 91 2 91 2 92')).toEqual([]);
  });

  it('normalises RA into [0, 360)', () => {
    const polys = parseStcs('POLYGON -1 0 361 0 0.5 1');
    expect(polys[0].map((p) => p.ra)).toEqual([359, 1, 0.5]);
  });

  it('skips NOT / unknown shapes and counts them, keeping the rest', () => {
    const r = parseStcsDetailed(
      'UNION (POLYGON 1 1 2 1 2 2 NOT (CIRCLE 5 5 1) BOX 1 1 2 2 POLYGON 7 7 8 7 8 8)'
    );
    expect(r.polygons).toHaveLength(2);
    // NOT (its circle operand is swallowed with it) and BOX
    expect(r.ignored).toBe(2);
  });

  it('tolerates nested parentheses and extra whitespace', () => {
    const polys = parseStcs('UNION ( ( POLYGON   1 1   2 1 2 2 ) ( POLYGON 3 3 4 3 4 4 ) )');
    expect(polys).toHaveLength(2);
  });

  it('parses scientific notation in the fast path', () => {
    const polys = parseStcs('POLYGON 1.5e2 -4.0e1 1.51e2 -40 150.5 -39.5');
    expect(polys).toHaveLength(1);
    expect(polys[0][0]).toEqual({ ra: 150, dec: -40 });
  });
});

describe('circleToPolygon', () => {
  it('places the vertices at the requested radius', () => {
    const poly = circleToPolygon(0, 0, 1, 8);
    expect(poly).toHaveLength(8);
    // the first vertex is due north of the centre
    expect(poly[0].ra).toBeCloseTo(0, 6);
    expect(poly[0].dec).toBeCloseTo(1, 6);
    // the "east" vertex is 1° away along the equator
    expect(poly[2].ra).toBeCloseTo(1, 6);
    expect(poly[2].dec).toBeCloseTo(0, 6);
  });
});

describe('footprintBounds', () => {
  it('bounds a simple polygon', () => {
    const b = footprintBounds(parseStcs(REAL_FIXTURE))!;
    expect(b.raMin).toBeCloseTo(151.7137, 4);
    expect(b.raMax).toBeCloseTo(151.7925, 4);
    expect(b.decMin).toBeCloseTo(-40.4729, 4);
    expect(b.decMax).toBeCloseTo(-40.4086, 4);
    expect(b.raSpan).toBeCloseTo(0.0788, 4);
  });

  it('is RA-wrap aware: 359.9 … 0.1 spans 0.2°, not 359.8°', () => {
    const b = footprintBounds(parseStcs('POLYGON 359.9 0 0.1 0 0.1 1 359.9 1'))!;
    expect(b.raMin).toBeCloseTo(359.9, 6);
    expect(b.raMax).toBeCloseTo(0.1, 6);
    expect(b.raSpan).toBeCloseTo(0.2, 6);
    expect(b.decSpan).toBeCloseTo(1, 6);
  });

  it('returns null for no polygons', () => {
    expect(footprintBounds([])).toBeNull();
  });

  it('covers several separate footprints', () => {
    const b = footprintBounds([
      ...parseStcs('POLYGON 10 10 11 10 11 11'),
      ...parseStcs('POLYGON 20 -5 21 -5 21 -4'),
    ])!;
    expect(b.raMin).toBe(10);
    expect(b.raMax).toBe(21);
    expect(b.decMin).toBe(-5);
    expect(b.decMax).toBe(11);
  });
});

describe('footprintCentroid', () => {
  it('averages across RA=0 correctly', () => {
    const c = footprintCentroid(parseStcs('POLYGON 359 0 1 0 1 2 359 2'))!;
    expect(c.ra).toBeCloseTo(0, 6);
    expect(c.dec).toBeCloseTo(1, 3);
  });

  it('returns null for no polygons', () => {
    expect(footprintCentroid([])).toBeNull();
  });
});

describe('fovForBounds', () => {
  it('scales the RA span by cos(dec) and adds a margin', () => {
    const b = footprintBounds(parseStcs('POLYGON 0 60 2 60 2 60.5 0 60.5'))!;
    // RA span 2° × cos 60.25° ≈ 0.99°; dec span 0.5° → 0.99 × 1.5
    expect(fovForBounds(b)).toBeCloseTo(2 * Math.cos((60.25 * Math.PI) / 180) * 1.5, 3);
  });

  it('clamps to the min/max', () => {
    const tiny = footprintBounds(parseStcs('POLYGON 0 0 0.001 0 0.001 0.001'))!;
    expect(fovForBounds(tiny)).toBe(0.05);
    const huge = footprintBounds(parseStcs('POLYGON 0 -80 180 -80 180 80 0 80'))!;
    expect(fovForBounds(huge)).toBe(180);
  });
});
