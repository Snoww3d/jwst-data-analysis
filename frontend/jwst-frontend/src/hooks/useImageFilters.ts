import { useState, useMemo } from 'react';
import type { JwstDataModel } from '../types/JwstDataTypes';

export const ALL_FILTER_VALUE = '__all__';
const UNKNOWN_TARGET_LABEL = 'Unknown Target';
const UNKNOWN_FILTER_LABEL = 'Unknown Filter';

export type StageFilterValue = typeof ALL_FILTER_VALUE | 'L1' | 'L2a' | 'L2b' | 'L3' | 'unknown';

export const STAGE_FILTER_OPTIONS: ReadonlyArray<{ value: StageFilterValue; label: string }> = [
  { value: ALL_FILTER_VALUE, label: 'All Stages' },
  { value: 'L3', label: 'L3 (Combined)' },
  { value: 'L2b', label: 'L2b (Calibrated)' },
  { value: 'L2a', label: 'L2a (Rate)' },
  { value: 'L1', label: 'L1 (Raw)' },
  { value: 'unknown', label: 'Unknown' },
];

/** Normalize hyphens/underscores to spaces for flexible matching. */
const normalize = (s: string): string => s.toLowerCase().replace(/[-_]/g, ' ');

export interface UseImageFiltersResult {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  targetFilter: string;
  setTargetFilter: (target: string) => void;
  stageFilter: StageFilterValue;
  setStageFilter: (stage: StageFilterValue) => void;
  wavelengthFilter: string;
  setWavelengthFilter: (wl: string) => void;
  targetOptions: string[];
  stageOptions: ReadonlyArray<{ value: StageFilterValue; label: string }>;
  wavelengthOptions: string[];
  filteredImages: JwstDataModel[];
  isFiltered: boolean;
  totalCount: number;
  filteredCount: number;
}

/**
 * Encapsulates cascading image filter logic (Target → Stage → Wavelength + search).
 * Designed for reuse across MosaicSelectStep and ChannelAssignStep.
 */
export function useImageFilters(images: JwstDataModel[]): UseImageFiltersResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [targetFilter, setTargetFilter] = useState<string>(ALL_FILTER_VALUE);
  const [stageFilter, setStageFilter] = useState<StageFilterValue>(ALL_FILTER_VALUE);
  const [wavelengthFilter, setWavelengthFilter] = useState<string>(ALL_FILTER_VALUE);

  // --- Cascading filter options ---

  const targetOptions = useMemo(() => {
    const targets = new Set<string>();
    images.forEach((img) => {
      targets.add(img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL);
    });
    return Array.from(targets).sort((a, b) => {
      if (a === UNKNOWN_TARGET_LABEL) return 1;
      if (b === UNKNOWN_TARGET_LABEL) return -1;
      return a.localeCompare(b);
    });
  }, [images]);

  const imagesAfterTarget = useMemo(
    () =>
      targetFilter === ALL_FILTER_VALUE
        ? images
        : images.filter(
            (img) => (img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL) === targetFilter
          ),
    [images, targetFilter]
  );

  const stageOptions = useMemo(() => {
    const stages = new Set<string>();
    imagesAfterTarget.forEach((img) => {
      stages.add(img.processingLevel ?? 'unknown');
    });
    return STAGE_FILTER_OPTIONS.filter(
      (opt) => opt.value === ALL_FILTER_VALUE || stages.has(opt.value)
    );
  }, [imagesAfterTarget]);

  const imagesAfterStage = useMemo(
    () =>
      stageFilter === ALL_FILTER_VALUE
        ? imagesAfterTarget
        : imagesAfterTarget.filter((img) => (img.processingLevel ?? 'unknown') === stageFilter),
    [imagesAfterTarget, stageFilter]
  );

  const wavelengthOptions = useMemo(() => {
    const filters = new Set<string>();
    imagesAfterStage.forEach((img) => {
      filters.add(img.imageInfo?.filter?.trim() || UNKNOWN_FILTER_LABEL);
    });
    return Array.from(filters).sort((a, b) => {
      if (a === UNKNOWN_FILTER_LABEL) return 1;
      if (b === UNKNOWN_FILTER_LABEL) return -1;
      return a.localeCompare(b);
    });
  }, [imagesAfterStage]);

  // --- Auto-reset downstream filters when upstream narrows ---
  if (stageFilter !== ALL_FILTER_VALUE && !stageOptions.some((o) => o.value === stageFilter)) {
    setStageFilter(ALL_FILTER_VALUE);
  }
  if (wavelengthFilter !== ALL_FILTER_VALUE && !wavelengthOptions.includes(wavelengthFilter)) {
    setWavelengthFilter(ALL_FILTER_VALUE);
  }

  // --- Final filtered list (preserves input order, no sorting) ---
  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      const imageTarget = img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL;
      if (targetFilter !== ALL_FILTER_VALUE && imageTarget !== targetFilter) return false;

      const imageStage = img.processingLevel ?? 'unknown';
      if (stageFilter !== ALL_FILTER_VALUE && imageStage !== stageFilter) return false;

      const imageFilter = img.imageInfo?.filter?.trim() || UNKNOWN_FILTER_LABEL;
      if (wavelengthFilter !== ALL_FILTER_VALUE && imageFilter !== wavelengthFilter) return false;

      if (searchTerm.trim()) {
        const term = normalize(searchTerm.trim());
        return (
          normalize(img.fileName).includes(term) ||
          (img.imageInfo?.targetName && normalize(img.imageInfo.targetName).includes(term)) ||
          (img.imageInfo?.filter && normalize(img.imageInfo.filter).includes(term)) ||
          (img.imageInfo?.instrument && normalize(img.imageInfo.instrument).includes(term))
        );
      }
      return true;
    });
  }, [images, targetFilter, stageFilter, wavelengthFilter, searchTerm]);

  const totalCount = images.length;
  const filteredCount = filteredImages.length;
  const isFiltered =
    searchTerm.trim() !== '' ||
    targetFilter !== ALL_FILTER_VALUE ||
    stageFilter !== ALL_FILTER_VALUE ||
    wavelengthFilter !== ALL_FILTER_VALUE;

  return {
    searchTerm,
    setSearchTerm,
    targetFilter,
    setTargetFilter,
    stageFilter,
    setStageFilter,
    wavelengthFilter,
    setWavelengthFilter,
    targetOptions,
    stageOptions,
    wavelengthOptions,
    filteredImages,
    isFiltered,
    totalCount,
    filteredCount,
  };
}
