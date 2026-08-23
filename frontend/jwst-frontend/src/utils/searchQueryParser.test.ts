import { describe, it, expect } from 'vitest';
import { parseSearchQuery, describeParsedQuery, type ParsedQuery } from './searchQueryParser';

/** RA/Dec expectations compared to 1e-6° so sexagesimal rounding is tolerated. */
function expectCoords(raw: string, ra: number, dec: number) {
  const parsed = parseSearchQuery(raw);
  expect(parsed.kind, raw).toBe('coords');
  if (parsed.kind !== 'coords') return;
  expect(parsed.ra, `${raw} ra`).toBeCloseTo(ra, 6);
  expect(parsed.dec, `${raw} dec`).toBeCloseTo(dec, 6);
}

describe('parseSearchQuery', () => {
  describe('the Discover chips', () => {
    it.each<[string, ParsedQuery]>([
      ['M16', { kind: 'target', name: 'M16' }],
      ['NGC 3324', { kind: 'target', name: 'NGC 3324' }],
      ['PID 2739', { kind: 'program', programId: '2739' }],
    ])('%s', (raw, expected) => {
      expect(parseSearchQuery(raw)).toEqual(expected);
    });

    it('10h 37m -58° (no seconds) is coordinates', () => {
      expectCoords('10h 37m -58°', 159.25, -58);
    });
  });

  describe('observation IDs', () => {
    it.each([
      'jw02739-o001_t001_nircam_clear-f090w',
      'JW02739-O001_T001_NIRCAM_CLEAR-F090W',
      'jw01234-o001',
      'jw02733',
    ])('%s', (raw) => {
      expect(parseSearchQuery(raw)).toEqual({ kind: 'obsId', obsId: raw });
    });

    it('rejects an obs-id with characters the backend refuses', () => {
      // `_SAFE_OBS_ID_PATTERN` is [a-zA-Z0-9._-]; a slash makes it a target
      // name MAST will simply fail to resolve, not a 400 from our backend.
      expect(parseSearchQuery('jw02739/o001').kind).toBe('target');
    });
  });

  describe('program IDs', () => {
    it.each([
      ['2739', '2739'],
      ['#2739', '2739'],
      ['pid 2739', '2739'],
      ['PID2739', '2739'],
      ['program 2739', '2739'],
      ['Program #2739', '2739'],
      ['prop 1234', '1234'],
      ['proposal 12345', '12345'],
      ['123', '123'],
    ])('%s → program %s', (raw, programId) => {
      expect(parseSearchQuery(raw)).toEqual({ kind: 'program', programId });
    });

    it.each(['12', '123456', 'pid', 'pid abc'])('%s is not a program ID', (raw) => {
      expect(parseSearchQuery(raw).kind).not.toBe('program');
    });
  });

  describe('decimal coordinates', () => {
    it.each<[string, number, number]>([
      ['159.25 -58.0', 159.25, -58],
      ['159.25, -58', 159.25, -58],
      ['159.25,-58', 159.25, -58],
      ['159.25 +12.5', 159.25, 12.5],
      ['159.25 12.5', 159.25, 12.5],
      ['0 0', 0, 0],
      ['359.9 0', 359.9, 0],
      ['180 -90', 180, -90],
      ['180 90', 180, 90],
      ['10.5   -20.25', 10.5, -20.25],
      ['159.25 −58', 159.25, -58], // U+2212 minus
    ])('%s', (raw, ra, dec) => expectCoords(raw, ra, dec));

    it.each(['400 0', '360 0', '0 95', '0 -95', '-1 0'])('rejects out-of-range %s', (raw) => {
      expect(parseSearchQuery(raw).kind).toBe('target');
    });
  });

  describe('sexagesimal coordinates', () => {
    it.each<[string, number, number]>([
      ['10h37m12.0s -58d12m34s', 159.3, -58.2094444],
      ['10h 37m 12s +58° 12\' 34"', 159.3, 58.2094444],
      ['10h37m12s −58°12′34″', 159.3, -58.2094444],
      ['10:37:12 -58:12:34', 159.3, -58.2094444],
      ['10:37:12 58:12:34', 159.3, 58.2094444],
      ['10 37 12 -58 12 34', 159.3, -58.2094444],
      ['10 37 12 58 12 34', 159.3, 58.2094444],
      ['10 37 12, -58 12 34', 159.3, -58.2094444],
      ['10h 37m -58°', 159.25, -58],
      ['10h -58°', 150, -58],
      ['00h 00m 00s +00d 00m 00s', 0, 0],
      ['23h 59m 59.9s -89d 59m 59s', 359.9995833, -89.9997222],
      ['12h30m -45d30m', 187.5, -45.5],
    ])('%s', (raw, ra, dec) => expectCoords(raw, ra, dec));

    it.each([
      '24h 00m 00s +00d', // RA 360 — out of range
      '10h 60m 00s +00d', // minutes ≥ 60
      '10h 37m 60s +00d', // seconds ≥ 60
      '10h 37m 12s +91d', // dec > 90
      '10h 37m 12s -90d 00m 01s', // dec < -90
      '-10h 37m +00d', // negative RA
    ])('rejects %s', (raw) => {
      expect(parseSearchQuery(raw).kind).toBe('target');
    });
  });

  describe('target names', () => {
    it.each([
      'Carina Nebula',
      'Westerlund 2',
      'NGC 3132',
      'M 16',
      'Sombrero Galaxy',
      'SMACS 0723',
      'WASP-39 b',
      'HD 189733',
      '2MASS J12345678+0123456',
      '1 2 3', // odd token count is not a coordinate pair
    ])('%s', (raw) => {
      expect(parseSearchQuery(raw)).toEqual({ kind: 'target', name: raw });
    });

    it('trims and treats an empty string as an empty target', () => {
      expect(parseSearchQuery('   ')).toEqual({ kind: 'target', name: '' });
      expect(parseSearchQuery('  M16  ')).toEqual({ kind: 'target', name: 'M16' });
    });
  });
});

describe('describeParsedQuery', () => {
  it.each<[string, string]>([
    ['jw02739-o001', 'Interpreted as: observation ID jw02739-o001'],
    ['PID 2739', 'Interpreted as: program 2739'],
    ['10h 37m -58°', 'Interpreted as: coordinates 159.25°, −58.00°'],
    ['159.25 -58', 'Interpreted as: coordinates 159.25°, −58.00°'],
    ['10h37m12.0s -58d12m34s', 'Interpreted as: coordinates 159.30°, −58.2094°'],
    ['NGC 3324', 'Interpreted as: target name "NGC 3324"'],
    ['', ''],
  ])('%s → %s', (raw, text) => {
    expect(describeParsedQuery(parseSearchQuery(raw))).toBe(text);
  });
});
