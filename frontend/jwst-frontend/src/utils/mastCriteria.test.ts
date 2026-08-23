import { describe, it, expect } from 'vitest';
import {
  EMPTY_FACETS,
  WIDE_WINDOW_DAYS,
  buildCriteria,
  calibLevelsFromParam,
  calibLevelsToParam,
  describeFacets,
  facetsEqual,
  facetsToUrl,
  hasNarrowingFacets,
  isEmptyFacets,
  removeFacetChip,
  urlToFacets,
  type FacetState,
} from './mastCriteria';
import { dateToMjd } from './timeUtils';

const FULL: FacetState = {
  instruments: ['MIRI', 'NIRCAM'],
  modes: ['IFU', 'IMAGE'],
  filters: ['F1130W', 'F770W'],
  dataproductTypes: ['cube', 'image'],
  calibLevels: [2, 3],
  dateFrom: '2024-01-01',
  dateTo: '2024-06-30',
  expMin: '10',
  expMax: '3600',
  intent: 'calibration',
  daysBack: 365,
};

function roundTrip(f: FacetState): FacetState {
  const params = new URLSearchParams();
  facetsToUrl(f, params);
  return urlToFacets(params);
}

describe('facetsToUrl / urlToFacets', () => {
  it('round-trips every field', () => {
    expect(roundTrip(FULL)).toEqual(FULL);
    expect(roundTrip(EMPTY_FACETS)).toEqual(EMPTY_FACETS);
  });

  it('writes nothing for the defaults', () => {
    const params = new URLSearchParams();
    facetsToUrl(EMPTY_FACETS, params);
    expect(params.toString()).toBe('');
  });

  it('uses repeated params for lists and the reserved names', () => {
    const params = new URLSearchParams();
    facetsToUrl(FULL, params);
    expect(params.getAll('inst')).toEqual(['MIRI', 'NIRCAM']);
    expect(params.getAll('mode')).toEqual(['IFU', 'IMAGE']);
    expect(params.getAll('filt')).toEqual(['F1130W', 'F770W']);
    expect(params.getAll('dpt')).toEqual(['cube', 'image']);
    expect(params.get('calib')).toBe('2,3');
    expect(params.get('from')).toBe('2024-01-01');
    expect(params.get('to')).toBe('2024-06-30');
    expect(params.get('exp')).toBe('10-3600');
    expect(params.get('intent')).toBe('calibration');
    expect(params.get('days')).toBe('365');
  });

  it('half-open exposure ranges keep their side', () => {
    expect(roundTrip({ ...EMPTY_FACETS, expMin: '10' })).toMatchObject({
      expMin: '10',
      expMax: '',
    });
    expect(roundTrip({ ...EMPTY_FACETS, expMax: '60' })).toMatchObject({
      expMin: '',
      expMax: '60',
    });
  });

  it('drops hand-edited nonsense instead of sending it on', () => {
    const params = new URLSearchParams(
      'inst=HUBBLE&inst=miri&mode=WIDE&filt=F200W;drop&filt=f444w&dpt=movie&calib=9&from=nope&to=2024-13-45&exp=abc&intent=maybe&days=-3'
    );
    expect(urlToFacets(params)).toEqual({
      ...EMPTY_FACETS,
      instruments: ['MIRI'],
      filters: ['F444W'],
    });
  });

  it('caps the filter list at 20', () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 25; i++) params.append('filt', `F${100 + i}W`);
    expect(urlToFacets(params).filters).toHaveLength(20);
  });
});

describe('calib param', () => {
  it('maps levels to the param and back', () => {
    expect(calibLevelsToParam([3])).toBeUndefined();
    expect(calibLevelsToParam([1, 2, 3])).toBe('all');
    expect(calibLevelsToParam([3, 2])).toBe('2,3');
    expect(calibLevelsFromParam(null)).toEqual([3]);
    expect(calibLevelsFromParam('all')).toEqual([1, 2, 3]);
    expect(calibLevelsFromParam('3,1')).toEqual([1, 3]);
    expect(calibLevelsFromParam('7')).toEqual([3]);
  });
});

describe('buildCriteria', () => {
  it('is undefined only when nothing at all would be sent', () => {
    expect(buildCriteria({ ...EMPTY_FACETS, intent: 'any' })).toBeUndefined();
  });

  it('sends science intent by default', () => {
    expect(buildCriteria(EMPTY_FACETS)).toEqual({ intentType: ['science'] });
  });

  it('wildcards bare instruments and crosses them with modes', () => {
    expect(buildCriteria({ ...EMPTY_FACETS, instruments: ['MIRI'] })?.instrument_name).toEqual([
      'MIRI*',
    ]);
    expect(
      buildCriteria({ ...EMPTY_FACETS, instruments: ['NIRSPEC', 'MIRI'], modes: ['IFU'] })
        ?.instrument_name
    ).toEqual(['MIRI/IFU', 'NIRSPEC/IFU']);
    expect(buildCriteria({ ...EMPTY_FACETS, modes: ['MSA'] })?.instrument_name).toEqual(['*/MSA']);
  });

  it('uppercases and de-duplicates filters, passes product types', () => {
    const c = buildCriteria({
      ...EMPTY_FACETS,
      filters: ['f770w', 'F770W', 'F1130W'],
      dataproductTypes: ['cube'],
    });
    expect(c?.filters).toEqual(['F1130W', 'F770W']);
    expect(c?.dataproduct_type).toEqual(['cube']);
  });

  it('turns the date range into an MJD t_min range covering whole days', () => {
    const c = buildCriteria({ ...EMPTY_FACETS, dateFrom: '2024-01-01', dateTo: '2024-01-02' });
    const lo = dateToMjd(new Date('2024-01-01T00:00:00Z'));
    expect(c?.t_min?.[0]).toBeCloseTo(lo, 6);
    // end of the `to` day
    expect(c?.t_min?.[1]).toBeCloseTo(lo + 2, 6);
  });

  it('closes a half-open date range', () => {
    const fromOnly = buildCriteria({ ...EMPTY_FACETS, dateFrom: '2024-01-01' })?.t_min;
    expect(fromOnly?.[0]).toBeCloseTo(dateToMjd(new Date('2024-01-01T00:00:00Z')), 6);
    expect(fromOnly?.[1]).toBeGreaterThan(dateToMjd(new Date()));
    const toOnly = buildCriteria({ ...EMPTY_FACETS, dateTo: '2024-01-01' })?.t_min;
    expect(toOnly?.[0]).toBe(0);
  });

  it('omits an inverted date range rather than sending a 400', () => {
    expect(
      buildCriteria({
        ...EMPTY_FACETS,
        dateFrom: '2024-06-01',
        dateTo: '2024-01-01',
        intent: 'any',
      })
    ).toBeUndefined();
  });

  it('turns exposure bounds into t_exptime, closing open ends', () => {
    expect(buildCriteria({ ...EMPTY_FACETS, expMin: '10', expMax: '60' })?.t_exptime).toEqual([
      10, 60,
    ]);
    expect(buildCriteria({ ...EMPTY_FACETS, expMin: '10' })?.t_exptime?.[0]).toBe(10);
    expect(buildCriteria({ ...EMPTY_FACETS, expMax: '60' })?.t_exptime).toEqual([0, 60]);
  });

  it('never emits a key the whitelist rejects', () => {
    const keys = Object.keys(buildCriteria(FULL) ?? {});
    for (const k of keys) {
      expect([
        'instrument_name',
        'filters',
        'dataproduct_type',
        'intentType',
        't_min',
        't_exptime',
      ]).toContain(k);
    }
    expect(keys).not.toContain('calib_level');
    expect(keys).not.toContain('t_obs_release');
  });
});

describe('predicates', () => {
  it('isEmptyFacets / hasNarrowingFacets / facetsEqual', () => {
    expect(isEmptyFacets(EMPTY_FACETS)).toBe(true);
    expect(isEmptyFacets({ ...EMPTY_FACETS, intent: 'any' })).toBe(false);
    expect(hasNarrowingFacets({ ...EMPTY_FACETS, intent: 'any' })).toBe(false);
    expect(hasNarrowingFacets({ ...EMPTY_FACETS, calibLevels: [1, 2, 3] })).toBe(false);
    expect(hasNarrowingFacets({ ...EMPTY_FACETS, filters: ['F200W'] })).toBe(true);
    expect(facetsEqual(FULL, { ...FULL })).toBe(true);
    expect(facetsEqual(FULL, { ...FULL, daysBack: undefined })).toBe(false);
  });
});

describe('describeFacets / removeFacetChip', () => {
  it('describes every facet as an uppercase chip with a swatch kind', () => {
    const chips = describeFacets(FULL, { showWindow: false, defaultWindowApplied: false });
    const labels = chips.map((c) => c.label);
    expect(labels).toEqual([
      'MIRI',
      'NIRCAM',
      'IFU',
      'IMAGE',
      'F1130W',
      'F770W',
      'CUBE',
      'IMAGE',
      'LEVEL 2,3',
      'FROM 2024-01-01',
      'TO 2024-06-30',
      'EXP ≥ 10 S',
      'EXP ≤ 3600 S',
      'CALIBRATION',
    ]);
    for (const c of chips) expect(c.label).toBe(c.label.toUpperCase());
    expect(chips.find((c) => c.label === 'MIRI')?.kind).toBe('miri');
    expect(chips.find((c) => c.label === 'NIRCAM')?.kind).toBe('nircam');
  });

  it('shows the default window only for facet-only searches without a date facet', () => {
    const f = { ...EMPTY_FACETS, instruments: ['MIRI'] };
    const shown = describeFacets(f, { showWindow: true, defaultWindowApplied: true });
    expect(shown.map((c) => c.label)).toContain('LAST 90 DAYS');
    expect(shown.find((c) => c.key === 'days')?.removable).toBe(true);
    expect(
      describeFacets(f, { showWindow: false, defaultWindowApplied: true }).map((c) => c.label)
    ).not.toContain('LAST 90 DAYS');
    expect(
      describeFacets(
        { ...f, dateFrom: '2024-01-01' },
        { showWindow: true, defaultWindowApplied: true }
      ).map((c) => c.label)
    ).not.toContain('LAST 90 DAYS');
  });

  it('removing the default window widens it; the widened window is not removable', () => {
    const f = { ...EMPTY_FACETS, instruments: ['MIRI'] };
    const widened = removeFacetChip(f, 'days');
    expect(widened.daysBack).toBe(WIDE_WINDOW_DAYS);
    const chips = describeFacets(widened, { showWindow: true, defaultWindowApplied: false });
    const win = chips.find((c) => c.key === 'days');
    expect(win?.label).toBe(`LAST ${WIDE_WINDOW_DAYS} DAYS`);
    expect(win?.removable).toBe(false);
    expect(removeFacetChip(widened, 'days')).toEqual(widened);
  });

  it('removes exactly the chip named', () => {
    expect(removeFacetChip(FULL, 'inst:MIRI').instruments).toEqual(['NIRCAM']);
    expect(removeFacetChip(FULL, 'mode:IFU').modes).toEqual(['IMAGE']);
    expect(removeFacetChip(FULL, 'filt:F770W').filters).toEqual(['F1130W']);
    expect(removeFacetChip(FULL, 'dpt:cube').dataproductTypes).toEqual(['image']);
    expect(removeFacetChip(FULL, 'calib').calibLevels).toEqual([3]);
    expect(removeFacetChip(FULL, 'from').dateFrom).toBe('');
    expect(removeFacetChip(FULL, 'to').dateTo).toBe('');
    expect(removeFacetChip(FULL, 'expMin').expMin).toBe('');
    expect(removeFacetChip(FULL, 'expMax').expMax).toBe('');
    expect(removeFacetChip(FULL, 'intent').intent).toBe('science');
    expect(removeFacetChip(FULL, 'bogus')).toBe(FULL);
  });
});
