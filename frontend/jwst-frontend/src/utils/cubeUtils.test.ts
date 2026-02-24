import { describe, it, expect } from 'vitest';
import {
  sliceToPhysicalValue,
  formatWavelength,
  getAxisLabel,
  formatSliceDisplay,
  getDefaultPlaybackSpeed,
} from './cubeUtils';
import type { CubeAxis3Info } from '../types/JwstDataTypes';

describe('sliceToPhysicalValue', () => {
  const axis3: CubeAxis3Info = {
    crval3: 5.0,
    cdelt3: 0.1,
    crpix3: 1,
    cunit3: 'um',
    ctype3: 'WAVE',
  };

  it('returns crval3 when sliceIndex=0 and crpix3=1', () => {
    // fitsPixel=1, value = 5.0 + 0.1*(1-1) = 5.0
    expect(sliceToPhysicalValue(0, axis3)).toBeCloseTo(5.0);
  });

  it('returns correct value for sliceIndex=9', () => {
    // fitsPixel=10, value = 5.0 + 0.1*(10-1) = 5.0 + 0.9 = 5.9
    expect(sliceToPhysicalValue(9, axis3)).toBeCloseTo(5.9);
  });

  it('handles crpix3 not equal to 1', () => {
    const axis: CubeAxis3Info = {
      crval3: 10.0,
      cdelt3: 0.5,
      crpix3: 5,
      cunit3: 'um',
      ctype3: 'WAVE',
    };
    // sliceIndex=0, fitsPixel=1, value = 10.0 + 0.5*(1-5) = 10.0 - 2.0 = 8.0
    expect(sliceToPhysicalValue(0, axis)).toBeCloseTo(8.0);
  });

  it('handles negative cdelt3', () => {
    const axis: CubeAxis3Info = {
      crval3: 100.0,
      cdelt3: -1.0,
      crpix3: 1,
      cunit3: 'nm',
      ctype3: 'WAVE',
    };
    // sliceIndex=5, fitsPixel=6, value = 100 + (-1)*(6-1) = 95
    expect(sliceToPhysicalValue(5, axis)).toBeCloseTo(95.0);
  });

  it('handles sliceIndex at crpix3-1 (reference pixel)', () => {
    const axis: CubeAxis3Info = {
      crval3: 42.0,
      cdelt3: 0.01,
      crpix3: 10,
      cunit3: 'um',
      ctype3: 'WAVE',
    };
    // sliceIndex=9, fitsPixel=10, value = 42.0 + 0.01*(10-10) = 42.0
    expect(sliceToPhysicalValue(9, axis)).toBeCloseTo(42.0);
  });
});

describe('formatWavelength', () => {
  it('formats um unit to micron symbol', () => {
    expect(formatWavelength(2.45, 'um')).toBe('2.450 μm');
  });

  it('formats nm unit', () => {
    expect(formatWavelength(100.5, 'nm')).toBe('100.5 nm');
  });

  it('formats angstrom unit', () => {
    expect(formatWavelength(0.05, 'angstrom')).toBe('0.05000 Å');
  });

  it('handles large values (>= 100) with 1 decimal', () => {
    expect(formatWavelength(1234.5, 'nm')).toBe('1234.5 nm');
  });

  it('handles values between 10 and 100 with 2 decimals', () => {
    expect(formatWavelength(25.678, 'um')).toBe('25.68 μm');
  });

  it('handles values between 1 and 10 with 3 decimals', () => {
    expect(formatWavelength(4.44, 'um')).toBe('4.440 μm');
  });

  it('handles values between 0.1 and 1 with 4 decimals', () => {
    expect(formatWavelength(0.5, 'um')).toBe('0.5000 μm');
  });

  it('handles very small values (< 0.1) with 5 decimals', () => {
    expect(formatWavelength(0.012, 'um')).toBe('0.01200 μm');
  });

  it('handles Hz unit', () => {
    expect(formatWavelength(1420.0, 'hz')).toBe('1420.0 Hz');
  });

  it('handles unknown unit passthrough', () => {
    expect(formatWavelength(42.0, 'custom_unit')).toBe('42.00 custom_unit');
  });

  it('handles negative values', () => {
    // Velocity can be negative
    expect(formatWavelength(-50.5, 'm')).toBe('-50.50 m');
  });
});

describe('getAxisLabel', () => {
  it('returns "Wavelength" for "WAVE"', () => {
    expect(getAxisLabel('WAVE')).toBe('Wavelength');
  });

  it('returns "Wavelength" for "WAVE-TAB"', () => {
    expect(getAxisLabel('WAVE-TAB')).toBe('Wavelength');
  });

  it('returns "Wavelength" for "LAMBDA"', () => {
    expect(getAxisLabel('LAMBDA')).toBe('Wavelength');
  });

  it('returns "Frequency" for "FREQ"', () => {
    expect(getAxisLabel('FREQ')).toBe('Frequency');
  });

  it('returns "Velocity" for "VELO-LSR"', () => {
    expect(getAxisLabel('VELO-LSR')).toBe('Velocity');
  });

  it('returns "Velocity" for "VELO"', () => {
    expect(getAxisLabel('VELO')).toBe('Velocity');
  });

  it('returns "Time" for "TIME"', () => {
    expect(getAxisLabel('TIME')).toBe('Time');
  });

  it('returns "Time" for "MJD-OBS"', () => {
    expect(getAxisLabel('MJD-OBS')).toBe('Time');
  });

  it('returns the raw ctype for unrecognized values', () => {
    expect(getAxisLabel('RANDOM')).toBe('RANDOM');
  });

  it('returns "Frame" for null/undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getAxisLabel(null as any)).toBe('Frame');
  });

  it('returns "Frame" for empty string', () => {
    expect(getAxisLabel('')).toBe('Frame');
  });

  it('is case-insensitive', () => {
    expect(getAxisLabel('wave')).toBe('Wavelength');
    expect(getAxisLabel('freq')).toBe('Frequency');
    expect(getAxisLabel('Velo')).toBe('Velocity');
  });
});

describe('formatSliceDisplay', () => {
  const axis3: CubeAxis3Info = {
    crval3: 5.0,
    cdelt3: 0.1,
    crpix3: 1,
    cunit3: 'um',
    ctype3: 'WAVE',
  };

  it('formats with axis3 and unit', () => {
    // sliceIndex=0, nSlices=10, physical = 5.0 um
    const result = formatSliceDisplay(0, 10, axis3, 'um', 'Frame');
    expect(result).toBe('Frame 1/10 | 5.000 μm');
  });

  it('formats without axis3 (null)', () => {
    const result = formatSliceDisplay(0, 10, null, '', 'Frame');
    expect(result).toBe('Frame 1/10');
  });

  it('uses 1-based slice numbers', () => {
    const result = formatSliceDisplay(9, 100, null, '', 'Slice');
    expect(result).toBe('Slice 10/100');
  });

  it('includes physical value with wavelength', () => {
    // sliceIndex=4, fitsPixel=5, value = 5.0 + 0.1*(5-1) = 5.4
    const result = formatSliceDisplay(4, 20, axis3, 'um', 'Wavelength');
    expect(result).toBe('Wavelength 5/20 | 5.400 μm');
  });

  it('omits physical value when sliceUnit is empty', () => {
    const result = formatSliceDisplay(0, 10, axis3, '', 'Frame');
    expect(result).toBe('Frame 1/10');
  });
});

describe('getDefaultPlaybackSpeed', () => {
  it('returns 2 for nSlices <= 100', () => {
    expect(getDefaultPlaybackSpeed(50)).toBe(2);
    expect(getDefaultPlaybackSpeed(100)).toBe(2);
    expect(getDefaultPlaybackSpeed(1)).toBe(2);
  });

  it('returns 1 for nSlices 101-500', () => {
    expect(getDefaultPlaybackSpeed(101)).toBe(1);
    expect(getDefaultPlaybackSpeed(200)).toBe(1);
    expect(getDefaultPlaybackSpeed(500)).toBe(1);
  });

  it('returns 0.5 for nSlices > 500', () => {
    expect(getDefaultPlaybackSpeed(501)).toBe(0.5);
    expect(getDefaultPlaybackSpeed(600)).toBe(0.5);
    expect(getDefaultPlaybackSpeed(1000)).toBe(0.5);
  });
});
