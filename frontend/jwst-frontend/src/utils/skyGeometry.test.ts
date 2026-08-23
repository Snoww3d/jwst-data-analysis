import { describe, expect, it } from 'vitest';
import {
  MAX_REGION_VERTICES,
  angularSeparation,
  boundingCircle,
  clipResults,
  describeRegion,
  downsampleVertices,
  footprintIntersectsRegion,
  parseRegionParam,
  regionTooLarge,
  serializeRegion,
  type SkyRegion,
} from './skyGeometry';

/** A small square footprint centred on (ra, dec), `half` degrees half-width. */
function square(ra: number, dec: number, half = 0.05) {
  return [
    { ra: ra - half, dec: dec - half },
    { ra: ra + half, dec: dec - half },
    { ra: ra + half, dec: dec + half },
    { ra: ra - half, dec: dec + half },
  ];
}

function sRegion(ra: number, dec: number, half = 0.05): string {
  return (
    'POLYGON ' +
    square(ra, dec, half)
      .map((p) => `${p.ra} ${p.dec}`)
      .join(' ')
  );
}

const circleAt = (ra: number, dec: number, r: number): SkyRegion => ({
  kind: 'circle',
  ra,
  dec,
  r,
});
const polyOf = (vertices: { ra: number; dec: number }[]): SkyRegion => ({
  kind: 'polygon',
  vertices,
});

describe('boundingCircle', () => {
  it('is the circle itself for a circle region', () => {
    expect(boundingCircle(circleAt(10, 20, 0.5))).toEqual({ ra: 10, dec: 20, radius: 0.5 });
  });

  it('clamps an oversize circle to the backend max', () => {
    expect(boundingCircle(circleAt(10, 20, 15))?.radius).toBe(10);
  });

  it('centres correctly across the RA=0 wrap', () => {
    const bc = boundingCircle(polyOf(square(0, 10, 1)))!; // vertices at RA 359 and 1
    expect(Math.min(bc.ra, 360 - bc.ra)).toBeLessThan(0.01);
    expect(bc.dec).toBeCloseTo(10, 1);
    expect(bc.radius).toBeGreaterThan(0.9);
    expect(bc.radius).toBeLessThan(2);
  });

  it('keeps the radius tight at high declination (no cos(dec) squash)', () => {
    // 1°-half-width square in RA at dec 80 is only ~0.17° across in RA.
    const bc = boundingCircle(polyOf(square(100, 80, 1)))!;
    expect(bc.dec).toBeCloseTo(80, 1);
    expect(bc.radius).toBeLessThan(1.5);
  });

  it('is null for a degenerate polygon', () => {
    expect(boundingCircle(polyOf([{ ra: 1, dec: 1 }]))).toBeNull();
  });
});

describe('regionTooLarge', () => {
  it('accepts a 5° circle and rejects a 12° circle', () => {
    expect(regionTooLarge(circleAt(10, 0, 5))).toBe(false);
    expect(regionTooLarge(circleAt(10, 0, 12))).toBe(true);
  });

  it('rejects a polygon spanning more than the max radius', () => {
    expect(regionTooLarge(polyOf(square(180, 0, 15)))).toBe(true);
    expect(regionTooLarge(polyOf(square(180, 0, 5)))).toBe(false);
  });
});

describe('footprintIntersectsRegion', () => {
  it('polygon region: footprint inside', () => {
    expect(footprintIntersectsRegion(square(100, -30, 0.05), polyOf(square(100, -30, 1)))).toBe(
      true
    );
  });

  it('polygon region: footprint containing the whole region', () => {
    expect(footprintIntersectsRegion(square(100, -30, 2), polyOf(square(100, -30, 0.2)))).toBe(
      true
    );
  });

  it('polygon region: footprint straddling an edge', () => {
    expect(footprintIntersectsRegion(square(101, -30, 0.1), polyOf(square(100, -30, 1)))).toBe(
      true
    );
  });

  it('polygon region: footprint outside', () => {
    expect(footprintIntersectsRegion(square(105, -30, 0.05), polyOf(square(100, -30, 1)))).toBe(
      false
    );
  });

  it('works across the RA=0 wrap (region at 359°, footprint at 0.5°)', () => {
    const region = polyOf(square(0, 10, 1)); // RA 359..1
    expect(footprintIntersectsRegion(square(0.5, 10, 0.1), region)).toBe(true);
    expect(footprintIntersectsRegion(square(3, 10, 0.1), region)).toBe(false);
  });

  it('works near the pole without RA distortion', () => {
    // (0, 89) and (180, 89.6) are on opposite sides of the pole: separation
    // is 1° + 0.4° = 1.4° despite the 180° RA difference.
    const region = circleAt(0, 89, 1.5);
    expect(footprintIntersectsRegion(square(180, 89.6, 0.05), region)).toBe(true);
    expect(footprintIntersectsRegion(square(180, 85, 0.05), region)).toBe(false);
  });

  it('circle region: vertex within radius', () => {
    expect(footprintIntersectsRegion(square(100.55, -30, 0.1), circleAt(100, -30, 0.5))).toBe(true);
  });

  it('circle region: centre inside a big footprint', () => {
    expect(footprintIntersectsRegion(square(100, -30, 2), circleAt(100, -30, 0.2))).toBe(true);
  });

  it('circle region: edge passes through, no vertex inside', () => {
    // A tall thin footprint whose near edge crosses the circle.
    const tall = [
      { ra: 100.4, dec: -32 },
      { ra: 100.5, dec: -32 },
      { ra: 100.5, dec: -28 },
      { ra: 100.4, dec: -28 },
    ];
    expect(footprintIntersectsRegion(tall, circleAt(100, -30, 0.45))).toBe(true);
  });

  it('circle region: clean miss', () => {
    expect(footprintIntersectsRegion(square(102, -30, 0.1), circleAt(100, -30, 0.5))).toBe(false);
  });
});

describe('clipResults', () => {
  const region = polyOf(square(100, -30, 1));

  it('keeps intersecting rows and drops the rest', () => {
    const rows = [
      { obs: 'in', s_region: sRegion(100, -30) },
      { obs: 'out', s_region: sRegion(120, -30) },
      { obs: 'edge', s_region: sRegion(101, -30, 0.2) },
    ];
    const { rows: kept, unclippable } = clipResults(rows, region);
    expect(kept.map((r) => r.obs)).toEqual(['in', 'edge']);
    expect(unclippable).toBe(0);
  });

  it('keeps a UNION footprint when only one member intersects', () => {
    const union = `UNION (${sRegion(150, 10)} ${sRegion(100, -30)})`;
    const { rows } = clipResults([{ s_region: union }], region);
    expect(rows).toHaveLength(1);
  });

  it('drops a UNION footprint when no member intersects', () => {
    const union = `UNION (${sRegion(150, 10)} ${sRegion(200, 40)})`;
    const { rows } = clipResults([{ s_region: union }], region);
    expect(rows).toHaveLength(0);
  });

  it('KEEPS unparseable rows and counts them', () => {
    const rows = [
      { obs: 'junk', s_region: 'ELLIPSE 1 2 3 4 5' },
      { obs: 'none', s_region: undefined },
      { obs: 'out', s_region: sRegion(120, -30) },
    ];
    const { rows: kept, unclippable } = clipResults(rows, region);
    expect(kept.map((r) => r.obs)).toEqual(['junk', 'none']);
    expect(unclippable).toBe(2);
  });
});

describe('region URL round-trip', () => {
  it('serialises and parses a circle', () => {
    const region = circleAt(10.123456, -20.987654, 0.5);
    const s = serializeRegion(region);
    expect(s).toBe('circle:10.1235,-20.9877,0.5');
    expect(parseRegionParam(s)).toEqual(circleAt(10.1235, -20.9877, 0.5));
  });

  it('serialises and parses a polygon', () => {
    const region = polyOf(square(100, -30, 1));
    const parsed = parseRegionParam(serializeRegion(region));
    expect(parsed).toEqual(region);
  });

  it('downsamples a dense polygon to the vertex cap', () => {
    const dense = Array.from({ length: 200 }, (_, i) => ({
      ra: 100 + Math.cos((2 * Math.PI * i) / 200),
      dec: -30 + Math.sin((2 * Math.PI * i) / 200),
    }));
    expect(downsampleVertices(dense)).toHaveLength(MAX_REGION_VERTICES);
    const s = serializeRegion(polyOf(dense));
    expect(s.split(';')).toHaveLength(MAX_REGION_VERTICES);
    expect(parseRegionParam(s)).not.toBeNull();
  });

  it('rejects junk, oversize and out-of-range values', () => {
    expect(parseRegionParam(null)).toBeNull();
    expect(parseRegionParam('')).toBeNull();
    expect(parseRegionParam('blob:1,2,3')).toBeNull();
    expect(parseRegionParam('circle:10,20')).toBeNull();
    expect(parseRegionParam('circle:10,95,1')).toBeNull();
    expect(parseRegionParam('circle:10,20,11')).toBeNull(); // > max radius
    expect(parseRegionParam('circle:10,20,abc')).toBeNull();
    expect(parseRegionParam('poly:1,2;3,4')).toBeNull(); // < 3 vertices
    expect(parseRegionParam('poly:170,0;190,0;180,15')).toBeNull(); // oversize
  });
});

describe('describeRegion', () => {
  it('labels circles and polygons', () => {
    expect(describeRegion(circleAt(1, 2, 0.5))).toBe('CIRCLE · R 0.50°');
    expect(describeRegion(polyOf(square(100, -30, 0.3)))).toMatch(/^POLYGON · 4 VTX \(≈0\.\d°\)$/);
  });
});

describe('angularSeparation', () => {
  it('measures across the wrap and at the pole', () => {
    expect(angularSeparation({ ra: 359.5, dec: 0 }, { ra: 0.5, dec: 0 })).toBeCloseTo(1, 5);
    expect(angularSeparation({ ra: 0, dec: 90 }, { ra: 180, dec: 89 })).toBeCloseTo(1, 5);
  });
});
