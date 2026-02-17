import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  JwstDataModel,
  ProcessingLevelColors,
  ProcessingLevelLabels,
} from '../../types/JwstDataTypes';
import { FootprintResponse } from '../../types/MosaicTypes';
import { API_BASE_URL } from '../../config/api';
import { formatFileSize } from '../../utils/formatUtils';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import { TelescopeIcon } from '../icons/DashboardIcons';
import FootprintPreview from './FootprintPreview';
import './MosaicSelectStep.css';

const ALL_FILTER_VALUE = '__all__';
const UNKNOWN_TARGET_LABEL = 'Unknown Target';
const UNKNOWN_FILTER_LABEL = 'Unknown Filter';

type StageFilterValue = typeof ALL_FILTER_VALUE | 'L1' | 'L2a' | 'L2b' | 'L3' | 'unknown';

const STAGE_FILTER_OPTIONS: ReadonlyArray<{ value: StageFilterValue; label: string }> = [
  { value: ALL_FILTER_VALUE, label: 'All Stages' },
  { value: 'L3', label: 'L3 (Combined)' },
  { value: 'L2b', label: 'L2b (Calibrated)' },
  { value: 'L2a', label: 'L2a (Rate)' },
  { value: 'L1', label: 'L1 (Raw)' },
  { value: 'unknown', label: 'Unknown' },
];

// Processing level sort order: raw first, then rate, calibrated, combined
const LEVEL_SORT_ORDER: Record<string, number> = {
  L1: 0,
  L2a: 1,
  L2b: 2,
  L3: 3,
  unknown: 4,
};

interface MosaicSelectStepProps {
  allImages: JwstDataModel[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  initialSelection?: string[];
  /** Max file size in bytes for mosaic generation. null = unknown (don't warn). */
  maxFileSizeBytes: number | null;
  footprintData: FootprintResponse | null;
  footprintLoading: boolean;
  footprintError: string | null;
  onRetryFootprints: () => void;
}

/**
 * Step 1: Select files for mosaic via thumbnail card grid with search/filter/target grouping
 */
export const MosaicSelectStep: React.FC<MosaicSelectStepProps> = ({
  allImages,
  selectedIds,
  onSelectionChange,
  initialSelection,
  footprintData,
  footprintLoading,
  footprintError,
  maxFileSizeBytes,
  onRetryFootprints,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [footprintExpanded, setFootprintExpanded] = useState(false);
  const [targetFilter, setTargetFilter] = useState<string>(ALL_FILTER_VALUE);
  const hasInitialSelection = initialSelection && initialSelection.length > 0;
  const [stageFilter, setStageFilter] = useState<StageFilterValue>(
    hasInitialSelection ? 'L3' : ALL_FILTER_VALUE
  );
  const [wavelengthFilter, setWavelengthFilter] = useState<string>(ALL_FILTER_VALUE);
  const [autoTargetApplied, setAutoTargetApplied] = useState<string | null>(null);
  const [autoStageApplied, setAutoStageApplied] = useState<string | null>(null);
  const [autoFilterApplied, setAutoFilterApplied] = useState<string | null>(null);
  const [autoTargetMixed, setAutoTargetMixed] = useState(false);
  const [autoStageMixed, setAutoStageMixed] = useState(false);
  const [autoFilterMixed, setAutoFilterMixed] = useState(false);
  const [autoLocked, setAutoLocked] = useState({ target: false, stage: false, filter: false });

  // Count oversized files in current selection
  const oversizedSelectedCount = useMemo(() => {
    if (maxFileSizeBytes === null) return 0;
    return allImages.filter((img) => selectedIds.has(img.id) && img.fileSize > maxFileSizeBytes)
      .length;
  }, [allImages, selectedIds, maxFileSizeBytes]);

  // Derive target names from pre-selected files (stable across renders)
  const preSelectedTargets = useMemo(() => {
    if (!initialSelection || initialSelection.length === 0) return new Set<string>();
    const targets = new Set<string>();
    for (const id of initialSelection) {
      const img = allImages.find((i) => i.id === id);
      if (img) targets.add(img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL);
    }
    return targets;
  }, [initialSelection, allImages]);

  // Auto-populate dropdowns from pre-selected files on mount
  useEffect(() => {
    if (!initialSelection || initialSelection.length === 0) return;

    const preSelectedImages = initialSelection
      .map((id) => allImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);

    if (preSelectedImages.length === 0) return;

    // Auto-set target if all share the same one
    const targets = new Set(
      preSelectedImages.map((img) => img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL)
    );
    if (targets.size === 1) {
      const matchedTarget = [...targets][0] as string;
      setTargetFilter(matchedTarget);
      setAutoTargetApplied(matchedTarget);
    } else if (targets.size > 1) {
      setAutoTargetMixed(true);
    }

    // Auto-set stage if all share the same one
    const stages = new Set(preSelectedImages.map((img) => img.processingLevel ?? 'unknown'));
    if (stages.size === 1) {
      const matchedStage = [...stages][0] as StageFilterValue;
      setStageFilter(matchedStage);
      setAutoStageApplied(matchedStage);
    } else {
      setStageFilter(ALL_FILTER_VALUE as StageFilterValue);
      if (stages.size > 1) {
        setAutoStageMixed(true);
      }
    }

    // Auto-set wavelength filter if all share the same one
    const filters = new Set(
      preSelectedImages.map((img) => img.imageInfo?.filter?.trim()).filter(Boolean)
    );
    if (filters.size === 1) {
      const matchedFilter = [...filters][0] as string;
      setWavelengthFilter(matchedFilter);
      setAutoFilterApplied(matchedFilter);
    } else if (filters.size > 1) {
      setAutoFilterMixed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascading filter options: Target → Stage → Filter (each scoped by filters to its left)
  const targetOptions = useMemo(() => {
    const targets = new Set<string>();
    allImages.forEach((img) => {
      targets.add(img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL);
    });
    return Array.from(targets).sort((a, b) => {
      if (a === UNKNOWN_TARGET_LABEL) return 1;
      if (b === UNKNOWN_TARGET_LABEL) return -1;
      return a.localeCompare(b);
    });
  }, [allImages]);

  // Images matching target filter (used to derive stage options)
  const imagesAfterTarget = useMemo(
    () =>
      targetFilter === ALL_FILTER_VALUE
        ? allImages
        : allImages.filter(
            (img) => (img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL) === targetFilter
          ),
    [allImages, targetFilter]
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

  // Images matching target + stage (used to derive wavelength filter options)
  const imagesAfterStage = useMemo(
    () =>
      stageFilter === ALL_FILTER_VALUE
        ? imagesAfterTarget
        : imagesAfterTarget.filter((img) => (img.processingLevel ?? 'unknown') === stageFilter),
    [imagesAfterTarget, stageFilter]
  );

  const wavelengthFilterOptions = useMemo(() => {
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

  // Auto-reset downstream filters when upstream narrows and current value is gone
  useEffect(() => {
    if (stageFilter !== ALL_FILTER_VALUE && !stageOptions.some((o) => o.value === stageFilter)) {
      setStageFilter(ALL_FILTER_VALUE);
    }
  }, [stageOptions, stageFilter]);

  useEffect(() => {
    if (
      wavelengthFilter !== ALL_FILTER_VALUE &&
      !wavelengthFilterOptions.includes(wavelengthFilter)
    ) {
      setWavelengthFilter(ALL_FILTER_VALUE);
    }
  }, [wavelengthFilterOptions, wavelengthFilter]);

  const filteredImages = useMemo(
    () =>
      allImages
        .filter((img) => {
          const imageTarget = img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL;
          if (targetFilter !== ALL_FILTER_VALUE && imageTarget !== targetFilter) return false;

          const imageStage = (img.processingLevel ?? 'unknown') as Exclude<
            StageFilterValue,
            typeof ALL_FILTER_VALUE
          >;
          if (stageFilter !== ALL_FILTER_VALUE && imageStage !== stageFilter) return false;

          const imageFilter = img.imageInfo?.filter?.trim() || UNKNOWN_FILTER_LABEL;
          if (wavelengthFilter !== ALL_FILTER_VALUE && imageFilter !== wavelengthFilter)
            return false;

          if (searchTerm.trim()) {
            // Normalize hyphens/underscores to spaces so "crab-nebula" matches "crab nebula"
            const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ');
            const term = normalize(searchTerm.trim());
            return (
              normalize(img.fileName).includes(term) ||
              (img.imageInfo?.targetName && normalize(img.imageInfo.targetName).includes(term)) ||
              (img.imageInfo?.filter && normalize(img.imageInfo.filter).includes(term)) ||
              (img.imageInfo?.instrument && normalize(img.imageInfo.instrument).includes(term))
            );
          }
          return true;
        })
        .sort((a, b) => {
          const orderA = LEVEL_SORT_ORDER[a.processingLevel ?? 'unknown'] ?? 4;
          const orderB = LEVEL_SORT_ORDER[b.processingLevel ?? 'unknown'] ?? 4;
          if (orderA !== orderB) return orderA - orderB;
          return a.fileName.localeCompare(b.fileName);
        }),
    [allImages, wavelengthFilter, searchTerm, stageFilter, targetFilter]
  );

  // Group filtered images by target name, with pre-selected targets first
  const groupedImages = useMemo(() => {
    const groups = new Map<string, JwstDataModel[]>();
    for (const img of filteredImages) {
      const target = img.imageInfo?.targetName?.trim() || UNKNOWN_TARGET_LABEL;
      const existing = groups.get(target);
      if (existing) {
        existing.push(img);
      } else {
        groups.set(target, [img]);
      }
    }
    return Array.from(groups.entries()).sort((a, b) => {
      // Pre-selected targets first
      const aMatch = preSelectedTargets.has(a[0]);
      const bMatch = preSelectedTargets.has(b[0]);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      // Within same tier: largest group first
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      // Unknown Target last
      if (a[0] === UNKNOWN_TARGET_LABEL) return 1;
      if (b[0] === UNKNOWN_TARGET_LABEL) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredImages, preSelectedTargets]);

  const toggleFileSelection = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange]
  );

  const handleSelectFiltered = useCallback(() => {
    onSelectionChange(new Set(filteredImages.map((img) => img.id)));
  }, [filteredImages, onSelectionChange]);

  const handleClearSelection = useCallback(() => {
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  // Selected images for footprint preview
  const selectedImages = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => allImages.find((img) => img.id === id))
        .filter((img): img is JwstDataModel => img !== undefined),
    [allImages, selectedIds]
  );

  return (
    <div className="mosaic-select-step">
      <div className="mosaic-select-toolbar">
        <div className="mosaic-search-bar">
          <input
            type="text"
            placeholder="Search by filename, target, filter, or instrument..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mosaic-search-input"
          />
          <span className="mosaic-selection-count">
            {selectedIds.size} selected (min 2) | {filteredImages.length} shown
          </span>
          <div className="mosaic-selection-actions">
            <button
              type="button"
              className="mosaic-selection-btn"
              onClick={handleSelectFiltered}
              disabled={filteredImages.length === 0}
            >
              Select Filtered
            </button>
            <button
              type="button"
              className="mosaic-selection-btn"
              onClick={handleClearSelection}
              disabled={selectedIds.size === 0}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="mosaic-filter-row">
          <div className="mosaic-filter-control">
            <label htmlFor="mosaic-target-filter">Target</label>
            <select
              id="mosaic-target-filter"
              value={targetFilter}
              onChange={(e) => {
                setTargetFilter(e.target.value);
                setAutoLocked((prev) => ({ ...prev, target: true }));
                setAutoTargetApplied(null);
              }}
            >
              <option value={ALL_FILTER_VALUE}>All Targets</option>
              {targetOptions.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </div>
          <div className="mosaic-filter-control">
            <label htmlFor="mosaic-stage-filter">Stage</label>
            <select
              id="mosaic-stage-filter"
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value as StageFilterValue);
                setAutoLocked((prev) => ({ ...prev, stage: true }));
                setAutoStageApplied(null);
              }}
            >
              {stageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mosaic-filter-control">
            <label htmlFor="mosaic-wavelength-filter">Filter</label>
            <select
              id="mosaic-wavelength-filter"
              value={wavelengthFilter}
              onChange={(e) => {
                setWavelengthFilter(e.target.value);
                setAutoLocked((prev) => ({ ...prev, filter: true }));
                setAutoFilterApplied(null);
              }}
            >
              <option value={ALL_FILTER_VALUE}>All Filters</option>
              {wavelengthFilterOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {(autoTargetApplied || autoStageApplied || autoFilterApplied) && (
        <div className="mosaic-auto-filter-notice">
          <span>
            Filtered to{' '}
            {[autoTargetApplied, autoStageApplied, autoFilterApplied]
              .filter(Boolean)
              .map((v) => <strong key={v}>{v}</strong>)
              .reduce<React.ReactNode[]>(
                (acc, el, i) => (i === 0 ? [el] : [...acc, ' + ', el]),
                []
              )}{' '}
            (matching selection)
          </span>
          <button
            type="button"
            className="mosaic-auto-filter-clear"
            onClick={() => {
              if (autoTargetApplied) setTargetFilter(ALL_FILTER_VALUE);
              if (autoStageApplied) setStageFilter(ALL_FILTER_VALUE as StageFilterValue);
              if (autoFilterApplied) setWavelengthFilter(ALL_FILTER_VALUE);
              setAutoTargetApplied(null);
              setAutoStageApplied(null);
              setAutoFilterApplied(null);
              setAutoLocked({ target: true, stage: true, filter: true });
            }}
          >
            Clear constraints
          </button>
        </div>
      )}

      {(autoTargetMixed || autoStageMixed || autoFilterMixed) &&
        (!autoLocked.target || !autoLocked.stage || !autoLocked.filter) && (
          <div className="mosaic-mixed-warnings">
            {autoTargetMixed && !autoLocked.target && (
              <div className="mosaic-mixed-warning mosaic-mixed-warning-target">
                <strong>Different targets.</strong> Mosaic combines spatially adjacent tiles — files
                from different targets point to different sky regions and won&apos;t overlap.
              </div>
            )}
            {autoStageMixed && !autoLocked.stage && (
              <div className="mosaic-mixed-warning mosaic-mixed-warning-stage">
                <strong>Mixed processing stages.</strong> Combining files at different calibration
                levels (e.g. L1 raw with L2b calibrated) may produce inconsistent results.
              </div>
            )}
            {autoFilterMixed && !autoLocked.filter && (
              <div className="mosaic-mixed-warning mosaic-mixed-warning-filter">
                <strong>Different filters.</strong> Mosaic combines spatial tiles at one wavelength
                — for multi-filter color images, use Composite instead.
              </div>
            )}
          </div>
        )}

      {oversizedSelectedCount > 0 && maxFileSizeBytes !== null && (
        <div className="mosaic-mixed-warnings">
          <div className="mosaic-mixed-warning mosaic-mixed-warning-size">
            <strong>
              {oversizedSelectedCount} selected file{oversizedSelectedCount !== 1 ? 's' : ''} exceed
              {oversizedSelectedCount === 1 ? 's' : ''} the {formatFileSize(maxFileSizeBytes)}{' '}
              generation limit.
            </strong>{' '}
            Footprint preview works, but mosaic generation will fail for oversized files. Remove
            them or reduce the selection.
          </div>
        </div>
      )}

      <div className="mosaic-card-grid-scroll">
        {filteredImages.length === 0 ? (
          <p className="mosaic-empty">No viewable images found.</p>
        ) : (
          groupedImages.map(([target, images], idx) => {
            const isMatchingTarget = preSelectedTargets.has(target);
            const hasPreSelection = preSelectedTargets.size > 0;
            // Show divider before the first non-matching group
            const prevTarget = idx > 0 ? groupedImages[idx - 1][0] : null;
            const showDivider =
              hasPreSelection &&
              !isMatchingTarget &&
              (prevTarget === null || preSelectedTargets.has(prevTarget));

            return (
              <React.Fragment key={target}>
                {showDivider && (
                  <div className="mosaic-target-divider">
                    <span>Other Targets</span>
                  </div>
                )}
                <div
                  className={`mosaic-target-group ${isMatchingTarget && hasPreSelection ? 'matching-target' : ''}`}
                >
                  <div className="mosaic-target-header">
                    <span className="mosaic-target-name">
                      {target}
                      {isMatchingTarget && hasPreSelection && (
                        <span className="mosaic-target-match-badge">selected</span>
                      )}
                    </span>
                    <span className="mosaic-target-count">{images.length} files</span>
                  </div>
                  <div className="mosaic-card-grid">
                    {images.map((img) => {
                      const isSelected = selectedIds.has(img.id);
                      const isOversized =
                        maxFileSizeBytes !== null && img.fileSize > maxFileSizeBytes;
                      return (
                        <div
                          key={img.id}
                          className={`mosaic-image-card ${isSelected ? 'selected' : ''} ${isOversized ? 'oversized' : ''}`}
                          onClick={() => toggleFileSelection(img.id)}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleFileSelection(img.id);
                            }
                          }}
                        >
                          <div className="mosaic-card-thumbnail">
                            {img.hasThumbnail ? (
                              <img
                                src={`${API_BASE_URL}/api/jwstdata/${img.id}/thumbnail`}
                                alt={img.fileName}
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const placeholder = (e.target as HTMLImageElement)
                                    .nextElementSibling;
                                  if (placeholder)
                                    (placeholder as HTMLElement).style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="mosaic-card-thumbnail-fallback"
                              style={{ display: img.hasThumbnail ? 'none' : 'flex' }}
                            >
                              <TelescopeIcon size={28} />
                            </div>
                            {isSelected && (
                              <div className="mosaic-card-check">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                                </svg>
                              </div>
                            )}
                            {isOversized && (
                              <div
                                className="mosaic-card-oversized"
                                title={`${formatFileSize(img.fileSize)} — exceeds ${maxFileSizeBytes ? formatFileSize(maxFileSizeBytes) : ''} generation limit`}
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M8 1.5a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0v-6A.75.75 0 018 1.5zM8 12a1 1 0 100 2 1 1 0 000-2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="mosaic-card-info">
                            <span className="mosaic-card-filter">{getFilterLabel(img)}</span>
                            {img.processingLevel && img.processingLevel !== 'unknown' && (
                              <span
                                className="mosaic-card-level"
                                style={{
                                  backgroundColor:
                                    ProcessingLevelColors[img.processingLevel] || '#6b7280',
                                }}
                                title={
                                  ProcessingLevelLabels[img.processingLevel] || img.processingLevel
                                }
                              >
                                {img.processingLevel}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Collapsible footprint preview when 2+ selected */}
      {selectedIds.size >= 2 && (
        <div className={`mosaic-inline-footprint ${footprintExpanded ? 'expanded' : ''}`}>
          <button
            className="mosaic-inline-footprint-toggle"
            onClick={() => setFootprintExpanded((prev) => !prev)}
            type="button"
          >
            <svg
              className={`mosaic-footprint-chevron ${footprintExpanded ? 'open' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
            <span>WCS Footprint Preview</span>
            {footprintLoading && <div className="mosaic-spinner small" />}
          </button>
          {footprintExpanded && (
            <div className="mosaic-inline-footprint-body">
              {footprintLoading && (
                <div className="mosaic-footprint-loading">
                  <div className="mosaic-spinner" />
                  <span>Loading footprints...</span>
                </div>
              )}
              {footprintError && (
                <div className="mosaic-footprint-error">
                  <p>{footprintError}</p>
                  <button onClick={onRetryFootprints} className="mosaic-btn-retry" type="button">
                    Retry
                  </button>
                </div>
              )}
              {!footprintLoading && !footprintError && !footprintData && (
                <p className="mosaic-footprint-empty">No footprint data to display yet.</p>
              )}
              {footprintData && !footprintLoading && (
                <FootprintPreview footprintData={footprintData} selectedImages={selectedImages} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MosaicSelectStep;
