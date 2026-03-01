import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImageFilters, ALL_FILTER_VALUE } from './useImageFilters';
import type { JwstDataModel } from '../types/JwstDataTypes';

/** Minimal helper to build a JwstDataModel for testing. */
function makeImage(
  overrides: Partial<JwstDataModel> & { id: string; fileName: string }
): JwstDataModel {
  return {
    dataType: 'image',
    uploadDate: '2024-01-01',
    metadata: {},
    fileSize: 1000,
    processingStatus: 'completed',
    tags: [],
    isArchived: false,
    processingResults: [],
    ...overrides,
  } as JwstDataModel;
}

const images: JwstDataModel[] = [
  makeImage({
    id: '1',
    fileName: 'crab_nebula_f200w.fits',
    processingLevel: 'L2b',
    imageInfo: {
      width: 100,
      height: 100,
      targetName: 'Crab Nebula',
      filter: 'F200W',
      instrument: 'NIRCam',
    },
  }),
  makeImage({
    id: '2',
    fileName: 'crab_nebula_f150w.fits',
    processingLevel: 'L2b',
    imageInfo: {
      width: 100,
      height: 100,
      targetName: 'Crab Nebula',
      filter: 'F150W',
      instrument: 'NIRCam',
    },
  }),
  makeImage({
    id: '3',
    fileName: 'orion_f200w.fits',
    processingLevel: 'L3',
    imageInfo: {
      width: 100,
      height: 100,
      targetName: 'Orion Nebula',
      filter: 'F200W',
      instrument: 'NIRCam',
    },
  }),
  makeImage({
    id: '4',
    fileName: 'orion_f770w.fits',
    processingLevel: 'L3',
    imageInfo: {
      width: 100,
      height: 100,
      targetName: 'Orion Nebula',
      filter: 'F770W',
      instrument: 'MIRI',
    },
  }),
  makeImage({
    id: '5',
    fileName: 'unknown_target.fits',
    processingLevel: 'L1',
    imageInfo: { width: 100, height: 100, filter: 'F444W', instrument: 'NIRCam' },
  }),
];

describe('useImageFilters', () => {
  it('returns all images when no filters are active', () => {
    const { result } = renderHook(() => useImageFilters(images));
    expect(result.current.filteredImages).toHaveLength(5);
    expect(result.current.isFiltered).toBe(false);
    expect(result.current.totalCount).toBe(5);
    expect(result.current.filteredCount).toBe(5);
  });

  it('computes sorted target options with Unknown last', () => {
    const { result } = renderHook(() => useImageFilters(images));
    expect(result.current.targetOptions).toEqual(['Crab Nebula', 'Orion Nebula', 'Unknown Target']);
  });

  it('filters by target', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setTargetFilter('Crab Nebula'));
    expect(result.current.filteredImages).toHaveLength(2);
    expect(
      result.current.filteredImages.every((img) => img.imageInfo?.targetName === 'Crab Nebula')
    ).toBe(true);
    expect(result.current.isFiltered).toBe(true);
  });

  it('cascades stage options from target selection', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setTargetFilter('Crab Nebula'));
    // Crab Nebula images are all L2b
    const stageValues = result.current.stageOptions.map((o) => o.value);
    expect(stageValues).toContain(ALL_FILTER_VALUE);
    expect(stageValues).toContain('L2b');
    expect(stageValues).not.toContain('L3');
    expect(stageValues).not.toContain('L1');
  });

  it('cascades wavelength options from target + stage selection', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setTargetFilter('Orion Nebula'));
    // Orion has F200W and F770W
    expect(result.current.wavelengthOptions).toEqual(['F200W', 'F770W']);
  });

  it('filters by stage', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setStageFilter('L3'));
    expect(result.current.filteredImages).toHaveLength(2);
    expect(result.current.filteredImages.every((img) => img.processingLevel === 'L3')).toBe(true);
  });

  it('filters by wavelength', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setWavelengthFilter('F200W'));
    expect(result.current.filteredImages).toHaveLength(2);
    expect(result.current.filteredImages.every((img) => img.imageInfo?.filter === 'F200W')).toBe(
      true
    );
  });

  it('filters by search term', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => result.current.setSearchTerm('crab'));
    expect(result.current.filteredImages).toHaveLength(2);
    expect(result.current.isFiltered).toBe(true);
  });

  it('normalizes hyphens and underscores in search', () => {
    const { result } = renderHook(() => useImageFilters(images));
    // "crab-nebula" should match "Crab Nebula" (target name)
    act(() => result.current.setSearchTerm('crab-nebula'));
    expect(result.current.filteredImages).toHaveLength(2);
  });

  it('search matches across fileName, targetName, filter, and instrument', () => {
    const { result } = renderHook(() => useImageFilters(images));
    // Search by instrument
    act(() => result.current.setSearchTerm('MIRI'));
    expect(result.current.filteredImages).toHaveLength(1);
    expect(result.current.filteredImages[0].id).toBe('4');
  });

  it('combines multiple filters', () => {
    const { result } = renderHook(() => useImageFilters(images));
    act(() => {
      result.current.setTargetFilter('Orion Nebula');
      result.current.setWavelengthFilter('F200W');
    });
    expect(result.current.filteredImages).toHaveLength(1);
    expect(result.current.filteredImages[0].id).toBe('3');
  });

  it('auto-resets downstream filter when upstream narrows', () => {
    const { result } = renderHook(() => useImageFilters(images));
    // Select a wavelength that exists globally
    act(() => result.current.setWavelengthFilter('F770W'));
    expect(result.current.filteredImages).toHaveLength(1);

    // Now restrict to Crab Nebula which has no F770W → wavelength should auto-reset
    act(() => result.current.setTargetFilter('Crab Nebula'));
    expect(result.current.wavelengthFilter).toBe(ALL_FILTER_VALUE);
    // Should show both Crab Nebula images since wavelength was reset
    expect(result.current.filteredImages).toHaveLength(2);
  });

  it('preserves input order (no sorting)', () => {
    const { result } = renderHook(() => useImageFilters(images));
    const ids = result.current.filteredImages.map((img) => img.id);
    expect(ids).toEqual(['1', '2', '3', '4', '5']);
  });

  it('handles empty image list', () => {
    const { result } = renderHook(() => useImageFilters([]));
    expect(result.current.filteredImages).toHaveLength(0);
    expect(result.current.targetOptions).toHaveLength(0);
    expect(result.current.isFiltered).toBe(false);
    expect(result.current.totalCount).toBe(0);
  });
});
