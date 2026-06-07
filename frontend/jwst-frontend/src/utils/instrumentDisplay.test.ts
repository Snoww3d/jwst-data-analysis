import { describe, it, expect } from 'vitest';
import { normalizeInstrument, formatInstruments } from './instrumentDisplay';

// Mirrors processing-engine/tests/test_recipe_engine.py::TestInstrumentDisplayNames
// to keep the frontend display helper in sync with the backend. (#1561 / #1454)
describe('normalizeInstrument', () => {
  it('drops the dataproduct-kind suffix', () => {
    expect(normalizeInstrument('NIRCAM/IMAGE')).toBe('NIRCam');
    expect(normalizeInstrument('MIRI/IMAGE')).toBe('MIRI');
    expect(normalizeInstrument('NIRISS/IMAGE')).toBe('NIRISS');
    expect(normalizeInstrument('NIRSPEC/IFU')).toBe('NIRSpec');
    expect(normalizeInstrument('FGS')).toBe('FGS');
  });

  it('is case-insensitive and strips whitespace', () => {
    expect(normalizeInstrument(' nircam/image ')).toBe('NIRCam');
  });

  it('falls back to title case for unknown instruments', () => {
    expect(normalizeInstrument('NEWCAM/THING')).toBe('Newcam');
  });
});

describe('formatInstruments', () => {
  it('orders short → long wavelength regardless of input order', () => {
    expect(formatInstruments(['MIRI/IMAGE', 'NIRCAM/IMAGE'])).toBe('NIRCam + MIRI');
  });

  it('returns an empty string for an empty list', () => {
    expect(formatInstruments([])).toBe('');
  });

  it('appends unknown instruments after known ones, sorted', () => {
    expect(formatInstruments(['NEWCAM', 'NIRCAM/IMAGE'])).toBe('NIRCam + Newcam');
  });

  it('de-duplicates', () => {
    expect(formatInstruments(['NIRCAM/IMAGE', 'NIRCAM/IMAGE'])).toBe('NIRCam');
  });
});
