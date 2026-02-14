import React, { useState, useMemo, useCallback } from 'react';
import {
  JwstDataModel,
  ProcessingLevelColors,
  ProcessingLevelLabels,
} from '../../types/JwstDataTypes';
import { FootprintResponse } from '../../types/MosaicTypes';
import { API_BASE_URL } from '../../config/api';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import { TelescopeIcon } from '../icons/DashboardIcons';
import FootprintPreview from './FootprintPreview';
import './MosaicSelectStep.css';

const ALL_FILTER_VALUE = '__all__';
const UNKNOWN_TARGET_LABEL = 'Unknown Target';
const UNKNOWN_INSTRUMENT_LABEL = 'Unknown Instrument';

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
  footprintData,
  footprintLoading,
  footprintError,
  onRetryFootprints,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [footprintExpanded, setFootprintExpanded] = useState(false);
  const [targetFilter, setTargetFilter] = useState<string>(ALL_FILTER_VALUE);
  const [stageFilter, setStageFilter] = useState<StageFilterValue>('L3');
  const [instrumentFilter, setInstrumentFilter] = useState<string>(ALL_FILTER_VALUE);

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

  const instrumentOptions = useMemo(() => {
    const instruments = new Set<string>();
    allImages.forEach((img) => {
      instruments.add(img.imageInfo?.instrument?.trim() || UNKNOWN_INSTRUMENT_LABEL);
    });
    return Array.from(instruments).sort((a, b) => {
      if (a === UNKNOWN_INSTRUMENT_LABEL) return 1;
      if (b === UNKNOWN_INSTRUMENT_LABEL) return -1;
      return a.localeCompare(b);
    });
  }, [allImages]);

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

          const imageInstrument = img.imageInfo?.instrument?.trim() || UNKNOWN_INSTRUMENT_LABEL;
          if (instrumentFilter !== ALL_FILTER_VALUE && imageInstrument !== instrumentFilter)
            return false;

          if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
              img.fileName.toLowerCase().includes(term) ||
              img.imageInfo?.targetName?.toLowerCase().includes(term) ||
              img.imageInfo?.filter?.toLowerCase().includes(term) ||
              img.imageInfo?.instrument?.toLowerCase().includes(term)
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
    [allImages, instrumentFilter, searchTerm, stageFilter, targetFilter]
  );

  // Group filtered images by target name (largest group first)
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
      // Largest group first
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      // Unknown Target last
      if (a[0] === UNKNOWN_TARGET_LABEL) return 1;
      if (b[0] === UNKNOWN_TARGET_LABEL) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredImages]);

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
              onChange={(e) => setTargetFilter(e.target.value)}
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
              onChange={(e) => setStageFilter(e.target.value as StageFilterValue)}
            >
              {STAGE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mosaic-filter-control">
            <label htmlFor="mosaic-instrument-filter">Instrument</label>
            <select
              id="mosaic-instrument-filter"
              value={instrumentFilter}
              onChange={(e) => setInstrumentFilter(e.target.value)}
            >
              <option value={ALL_FILTER_VALUE}>All Instruments</option>
              {instrumentOptions.map((instrument) => (
                <option key={instrument} value={instrument}>
                  {instrument}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mosaic-card-grid-scroll">
        {filteredImages.length === 0 ? (
          <p className="mosaic-empty">No viewable images found.</p>
        ) : (
          groupedImages.map(([target, images]) => (
            <div key={target} className="mosaic-target-group">
              <div className="mosaic-target-header">
                <span className="mosaic-target-name">{target}</span>
                <span className="mosaic-target-count">{images.length} files</span>
              </div>
              <div className="mosaic-card-grid">
                {images.map((img) => {
                  const isSelected = selectedIds.has(img.id);
                  return (
                    <div
                      key={img.id}
                      className={`mosaic-image-card ${isSelected ? 'selected' : ''}`}
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
                              const placeholder = (e.target as HTMLImageElement).nextElementSibling;
                              if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
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
          ))
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
