import React from 'react';
import { ALL_FILTER_VALUE, type UseImageFiltersResult } from '../../hooks/useImageFilters';
import './ImageFilterToolbar.css';

interface ImageFilterToolbarProps {
  filters: UseImageFiltersResult;
  variant?: 'wide' | 'compact';
  className?: string;
}

/**
 * Shared search + cascading dropdown toolbar for filtering image lists.
 * Used in ChannelAssignStep (compact) and designed for MosaicSelectStep (wide) migration.
 */
export const ImageFilterToolbar: React.FC<ImageFilterToolbarProps> = ({
  filters,
  variant = 'compact',
  className,
}) => {
  const {
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
    isFiltered,
    totalCount,
    filteredCount,
  } = filters;

  return (
    <div className={`image-filter-toolbar ${variant}${className ? ` ${className}` : ''}`}>
      <div className="ift-search-row">
        <input
          type="text"
          placeholder="Search by name, target, filter..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="ift-search-input"
        />
        {isFiltered && (
          <span className="ift-filter-count">
            {filteredCount} of {totalCount}
          </span>
        )}
      </div>
      <div className="ift-filter-row">
        <div className="ift-filter-control">
          <label htmlFor="ift-target-filter">Target</label>
          <select
            id="ift-target-filter"
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
        <div className="ift-filter-control">
          <label htmlFor="ift-stage-filter">Stage</label>
          <select
            id="ift-stage-filter"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}
          >
            {stageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ift-filter-control">
          <label htmlFor="ift-wavelength-filter">Filter</label>
          <select
            id="ift-wavelength-filter"
            value={wavelengthFilter}
            onChange={(e) => setWavelengthFilter(e.target.value)}
          >
            <option value={ALL_FILTER_VALUE}>All Filters</option>
            {wavelengthOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default ImageFilterToolbar;
