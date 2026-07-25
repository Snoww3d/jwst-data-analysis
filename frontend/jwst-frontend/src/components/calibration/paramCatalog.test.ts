/**
 * Curated parameter catalog (#1737) — the value encoding matters most: the
 * free-form editor's conventions ("010" stays a string, bare words don't) have
 * to survive a round trip through a typed control.
 */

import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, specFor } from './paramCatalog';

/** Fails with the missing key rather than a bare non-null assertion. */
function mustSpec(step: string, param: string) {
  const spec = specFor(step, param);
  if (!spec) throw new Error(`catalog is missing ${step}.${param}`);
  return spec;
}

describe('specFor', () => {
  it('knows the parameters the seed recipes actually use', () => {
    expect(specFor('jump', 'maximum_cores')?.control).toBe('enum');
    expect(specFor('jump', 'maximum_cores')?.options).toContain('half');
    expect(specFor('jump', 'expand_large_events')?.control).toBe('boolean');
    expect(specFor('bkg_subtract', 'sigma')?.control).toBe('number');
  });

  it('treats `skip` as a boolean even for an uncatalogued step', () => {
    // Every jwst step accepts skip; a true/false value should never land in a
    // free-text box just because we didn't enumerate the step.
    const spec = specFor('some_new_step', 'skip');
    expect(spec?.control).toBe('boolean');
    expect(spec?.label).toMatch(/some_new_step/);
  });

  it('returns undefined for anything else, so it falls through to Advanced', () => {
    expect(specFor('tweakreg', 'not_a_real_param')).toBeUndefined();
  });
});

describe('value round trip', () => {
  it('unwraps stored JSON strings for display', () => {
    expect(decodeValue('"half"')).toBe('half');
    expect(decodeValue('true')).toBe('true');
    expect(decodeValue('2')).toBe('2');
  });

  it('re-quotes text that would otherwise be read back as a number', () => {
    // The "010" case the free-form editor documents — without quoting it would
    // come back as the number 10.
    const spec = mustSpec('tweakreg', 'abs_refcat');
    expect(encodeValue(spec, '010')).toBe('"010"');
    expect(encodeValue(spec, 'GAIADR3')).toBe('GAIADR3');
  });

  it('normalises booleans and leaves numbers bare', () => {
    const bool = mustSpec('persistence', 'skip');
    expect(encodeValue(bool, 'true')).toBe('true');
    expect(encodeValue(bool, 'anything else')).toBe('false');

    const num = mustSpec('bkg_subtract', 'sigma');
    expect(encodeValue(num, ' 2.5 ')).toBe('2.5');
  });

  it('survives decode -> encode for an enum', () => {
    const spec = mustSpec('jump', 'maximum_cores');
    expect(encodeValue(spec, decodeValue('"half"'))).toBe('half');
  });
});
