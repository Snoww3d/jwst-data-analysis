import React from 'react';
import './DashboardToolbar.css';

interface DashboardToolbarProps {
  searchTerm: string;
  selectedDataType: string;
  selectedProcessingLevel: string;
  selectedViewability: string;
  selectedTag: string;
  onSearchChange: (term: string) => void;
  onDataTypeChange: (type: string) => void;
  onProcessingLevelChange: (level: string) => void;
  onViewabilityChange: (viewability: string) => void;
  onTagChange: (tag: string) => void;

  baseFilteredCount: number;
  afterTypeFilterCount: number;
  afterLevelFilterCount: number;
  availableTypes: {
    dataTypeCounts: Map<string, number>;
    viewableCount: number;
    tableCount: number;
  };
  availableLevels: Map<string, number>;
  availableTags: Array<{ value: string; label: string; count: number }>;

  viewMode: 'lineage' | 'target';
  onViewModeChange: (mode: 'lineage' | 'target') => void;

  showArchived: boolean;
  onToggleArchived: () => void;
  onShowUpload: () => void;
  showMastSearch: boolean;
  onToggleMastSearch: () => void;
  showWhatsNew: boolean;
  onToggleWhatsNew: () => void;

  selectedForCompositeCount: number;
  onOpenCompositeWizard: () => void;
  onOpenMosaicWizard: () => void;
  onOpenComparisonPicker: () => void;

  isSyncingMast: boolean;
  onSyncMast: () => void;
}

const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
  searchTerm,
  selectedDataType,
  selectedProcessingLevel,
  selectedViewability,
  selectedTag,
  onSearchChange,
  onDataTypeChange,
  onProcessingLevelChange,
  onViewabilityChange,
  onTagChange,

  baseFilteredCount,
  afterTypeFilterCount,
  afterLevelFilterCount,
  availableTypes,
  availableLevels,
  availableTags,

  viewMode,
  onViewModeChange,

  showArchived,
  onToggleArchived,
  onShowUpload,
  showMastSearch,
  onToggleMastSearch,
  showWhatsNew,
  onToggleWhatsNew,

  selectedForCompositeCount,
  onOpenCompositeWizard,
  onOpenMosaicWizard,
  onOpenComparisonPicker,

  isSyncingMast,
  onSyncMast,
}) => {
  const handleTypeFilterChange = (val: string) => {
    if (val === '__viewable' || val === '__table') {
      onDataTypeChange('all');
      onViewabilityChange(val === '__viewable' ? 'viewable' : 'table');
    } else {
      onDataTypeChange(val);
      onViewabilityChange('all');
    }
  };

  const typeFilterValue =
    selectedViewability === 'viewable'
      ? '__viewable'
      : selectedViewability === 'table'
        ? '__table'
        : selectedDataType;

  return (
    <div className="dashboard-header">
      <div className="controls">
        <div className="controls-row controls-row-filters">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search files, descriptions, or tags..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="filter-box">
            <label htmlFor="data-type-filter" className="visually-hidden">
              Filter by Type
            </label>
            <select
              id="data-type-filter"
              value={typeFilterValue}
              onChange={(e) => handleTypeFilterChange(e.target.value)}
            >
              <option value="all">All Types ({baseFilteredCount})</option>
              <optgroup label="FITS Content">
                {availableTypes.viewableCount > 0 && (
                  <option value="__viewable">
                    Viewable / Images ({availableTypes.viewableCount})
                  </option>
                )}
                {availableTypes.tableCount > 0 && (
                  <option value="__table">Tables Only ({availableTypes.tableCount})</option>
                )}
              </optgroup>
              <optgroup label="Data Category">
                {[
                  { value: 'image', label: 'Images' },
                  { value: 'spectral', label: 'Spectral' },
                  { value: 'calibration', label: 'Calibration' },
                  { value: 'sensor', label: 'Sensor' },
                  { value: 'raw', label: 'Raw / Uncal' },
                ].map((opt) => {
                  const count = availableTypes.dataTypeCounts.get(opt.value) || 0;
                  return count > 0 ? (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({count})
                    </option>
                  ) : null;
                })}
              </optgroup>
            </select>
          </div>
          <div className="filter-box">
            <label htmlFor="processing-level-filter" className="visually-hidden">
              Filter by Processing Level
            </label>
            <select
              id="processing-level-filter"
              value={selectedProcessingLevel}
              onChange={(e) => onProcessingLevelChange(e.target.value)}
            >
              <option value="all">All Levels ({afterTypeFilterCount})</option>
              {[
                { value: 'L1', label: 'Level 1 (Raw)' },
                { value: 'L2a', label: 'Level 2a (Rate)' },
                { value: 'L2b', label: 'Level 2b (Calibrated)' },
                { value: 'L3', label: 'Level 3 (Combined)' },
                { value: 'unknown', label: 'Unknown' },
              ].map((opt) => {
                const count = availableLevels.get(opt.value) || 0;
                return count > 0 ? (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({count})
                  </option>
                ) : null;
              })}
            </select>
          </div>
          <div className="filter-box">
            <label htmlFor="tag-filter" className="visually-hidden">
              Filter by Tag
            </label>
            <select
              id="tag-filter"
              value={selectedTag}
              onChange={(e) => onTagChange(e.target.value)}
            >
              <option value="all">All Tags ({afterLevelFilterCount})</option>
              {availableTags.map((tag) => (
                <option key={tag.value} value={tag.value}>
                  {tag.label} ({tag.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="controls-row controls-row-primary-actions">
          <button className="upload-btn" onClick={onShowUpload}>
            Upload Data
          </button>
          <button
            className={`mast-search-btn ${showMastSearch ? 'active' : ''}`}
            onClick={onToggleMastSearch}
          >
            {showMastSearch ? 'Hide MAST Search' : 'Search MAST'}
          </button>
          <button
            className={`whats-new-btn ${showWhatsNew ? 'active' : ''}`}
            onClick={onToggleWhatsNew}
          >
            {showWhatsNew ? "Hide What's New" : "What's New"}
          </button>
        </div>

        <div className="controls-row controls-row-secondary-actions">
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'lineage' ? 'active' : ''}`}
              onClick={() => onViewModeChange('lineage')}
              title="Lineage Tree View"
            >
              <span className="icon">⌲</span> Lineage
            </button>
            <button
              className={`view-btn ${viewMode === 'target' ? 'active' : ''}`}
              onClick={() => onViewModeChange('target')}
              title="Group by Target Name"
            >
              <span className="icon">🎯</span> By Target
            </button>
          </div>
          <button
            className={`archived-toggle ${showArchived ? 'active' : ''}`}
            onClick={onToggleArchived}
          >
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          <button
            className="import-mast-btn"
            onClick={onSyncMast}
            disabled={isSyncingMast}
            title="Scan disk for MAST files, import new ones, and refresh metadata for existing ones"
          >
            {isSyncingMast ? 'Syncing...' : 'Sync MAST Files'}
          </button>
        </div>

        <div className="controls-row controls-row-analysis-actions">
          <button
            className={`composite-btn ${selectedForCompositeCount >= 3 ? 'ready' : ''}`}
            onClick={onOpenCompositeWizard}
            disabled={selectedForCompositeCount < 3}
            title={
              selectedForCompositeCount >= 3
                ? 'Create RGB composite from selected images'
                : `Select 3+ images for RGB composite (${selectedForCompositeCount} selected)`
            }
          >
            <span className="composite-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="8" r="4" fill="#ff4444" opacity="0.8" />
                <circle cx="16" cy="8" r="4" fill="#44ff44" opacity="0.8" />
                <circle cx="12" cy="14" r="4" fill="#4488ff" opacity="0.8" />
              </svg>
            </span>
            RGB Composite ({selectedForCompositeCount} selected)
          </button>
          <button
            className="mosaic-open-btn"
            onClick={onOpenMosaicWizard}
            title="Create a WCS-aligned mosaic from multiple FITS images"
          >
            <span className="mosaic-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#4488ff" />
                <rect x="13" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#44ddff" />
                <rect x="2" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#8844ff" />
                <rect x="13" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#44ff88" />
              </svg>
            </span>
            WCS Mosaic
          </button>
          <button
            className="compare-open-btn"
            onClick={onOpenComparisonPicker}
            title="Compare two FITS images (blink, side-by-side, or overlay)"
          >
            <span className="compare-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="3" width="8" height="18" rx="1" />
                <rect x="14" y="3" width="8" height="18" rx="1" />
              </svg>
            </span>
            Compare
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardToolbar;
