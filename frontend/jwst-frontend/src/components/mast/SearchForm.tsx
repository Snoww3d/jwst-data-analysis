import React from 'react';
import { MastSearchType } from '../../types/MastTypes';
import type { DownloadSource } from '../../services';
import './SearchForm.css';

interface SearchFormProps {
  searchType: MastSearchType;
  onSearchTypeChange: (type: MastSearchType) => void;
  targetName: string;
  onTargetNameChange: (value: string) => void;
  ra: string;
  onRaChange: (value: string) => void;
  dec: string;
  onDecChange: (value: string) => void;
  radius: string;
  onRadiusChange: (value: string) => void;
  obsId: string;
  onObsIdChange: (value: string) => void;
  programId: string;
  onProgramIdChange: (value: string) => void;
  showAllCalibLevels: boolean;
  onShowAllCalibLevelsChange: (value: boolean) => void;
  downloadSource: DownloadSource;
  onDownloadSourceChange: (value: DownloadSource) => void;
  loading: boolean;
  onSearch: () => void;
}

/**
 * The 4 search-mode form (target/coordinates/observation/program) plus the
 * calibration-level and download-source options row.
 *
 * Relocated from MastSearch.tsx (#1617) — behavior preserved verbatim.
 */
const SearchForm: React.FC<SearchFormProps> = ({
  searchType,
  onSearchTypeChange,
  targetName,
  onTargetNameChange,
  ra,
  onRaChange,
  dec,
  onDecChange,
  radius,
  onRadiusChange,
  obsId,
  onObsIdChange,
  programId,
  onProgramIdChange,
  showAllCalibLevels,
  onShowAllCalibLevelsChange,
  downloadSource,
  onDownloadSourceChange,
  loading,
  onSearch,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch();
    }
  };

  return (
    <>
      <div className="search-type-selector">
        <label className={searchType === 'target' ? 'selected' : ''}>
          <input
            type="radio"
            value="target"
            checked={searchType === 'target'}
            onChange={() => onSearchTypeChange('target')}
          />
          Target Name
        </label>
        <label className={searchType === 'coordinates' ? 'selected' : ''}>
          <input
            type="radio"
            value="coordinates"
            checked={searchType === 'coordinates'}
            onChange={() => onSearchTypeChange('coordinates')}
          />
          Coordinates
        </label>
        <label className={searchType === 'observation' ? 'selected' : ''}>
          <input
            type="radio"
            value="observation"
            checked={searchType === 'observation'}
            onChange={() => onSearchTypeChange('observation')}
          />
          Observation ID
        </label>
        <label className={searchType === 'program' ? 'selected' : ''}>
          <input
            type="radio"
            value="program"
            checked={searchType === 'program'}
            onChange={() => onSearchTypeChange('program')}
          />
          Program ID
        </label>
      </div>

      <div className="search-options-row">
        {/* Calibration level filter - hidden for observation ID searches */}
        {searchType !== 'observation' && (
          <label className="calib-level-toggle">
            <input
              type="checkbox"
              checked={showAllCalibLevels}
              onChange={(e) => onShowAllCalibLevelsChange(e.target.checked)}
            />
            <span className="toggle-label">Show all calibration levels</span>
            <span className="toggle-hint">
              {showAllCalibLevels
                ? '(Levels 1-3: includes individual exposures)'
                : '(Level 3 only: combined/mosaic images)'}
            </span>
          </label>
        )}

        <label className="download-source-label">
          <span className="toggle-label">Download source:</span>
          <select
            value={downloadSource}
            onChange={(e) => onDownloadSourceChange(e.target.value as DownloadSource)}
            className="download-source-select"
          >
            <option value="auto">Auto (S3 preferred)</option>
            <option value="s3">S3 Direct</option>
            <option value="http">HTTP (MAST)</option>
          </select>
        </label>
      </div>

      <div className="search-inputs">
        {searchType === 'target' && (
          <>
            <input
              type="text"
              placeholder="Target name (e.g., NGC 3132, Carina Nebula)"
              value={targetName}
              onChange={(e) => onTargetNameChange(e.target.value)}
              onKeyPress={handleKeyPress}
              className="search-input-main"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => onRadiusChange(e.target.value)}
              step="0.1"
              min="0.01"
              max="10"
              className="search-input-small"
            />
          </>
        )}

        {searchType === 'coordinates' && (
          <>
            <input
              type="number"
              placeholder="RA (degrees)"
              value={ra}
              onChange={(e) => onRaChange(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Dec (degrees)"
              value={dec}
              onChange={(e) => onDecChange(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => onRadiusChange(e.target.value)}
              step="0.1"
              className="search-input-small"
            />
          </>
        )}

        {searchType === 'observation' && (
          <input
            type="text"
            placeholder="Observation ID (e.g., jw02729-o001_s00001)"
            value={obsId}
            onChange={(e) => onObsIdChange(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        {searchType === 'program' && (
          <input
            type="text"
            placeholder="Program ID (e.g., 2729)"
            value={programId}
            onChange={(e) => onProgramIdChange(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        <button
          onClick={onSearch}
          disabled={loading}
          className={`btn-base btn-large search-button ${loading ? 'searching' : ''}`}
        >
          {loading ? (
            <>
              <span className="search-spinner" />
              Searching MAST...
            </>
          ) : (
            'Search MAST'
          )}
        </button>
      </div>
    </>
  );
};

export default SearchForm;
