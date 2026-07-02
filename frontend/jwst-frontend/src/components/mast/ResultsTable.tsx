import React from 'react';
import { Link } from 'react-router-dom';
import { MastObservationResult } from '../../types/MastTypes';
import type { DataAvailabilityItem } from '../../types/JwstDataTypes';
import './ResultsTable.css';

const formatExposureTime = (expTime: number | undefined) => {
  if (expTime === undefined || expTime === null) return '-';
  if (expTime < 1) return `${(expTime * 1000).toFixed(0)}ms`;
  if (expTime < 60) return `${expTime.toFixed(1)}s`;
  return `${(expTime / 60).toFixed(1)}m`;
};

const formatDate = (dateValue: string | number | undefined) => {
  if (dateValue === undefined || dateValue === null) return '-';
  try {
    // MAST returns dates as Modified Julian Date (MJD) numbers
    // MJD 0 = November 17, 1858; Unix epoch (Jan 1, 1970) = MJD 40587
    if (typeof dateValue === 'number') {
      const unixMs = (dateValue - 40587) * 86400 * 1000;
      return new Date(unixMs).toLocaleDateString();
    }
    return new Date(dateValue).toLocaleDateString();
  } catch {
    return String(dateValue);
  }
};

interface ResultsTableProps {
  searchResults: MastObservationResult[];
  paginatedResults: MastObservationResult[];
  startIndex: number;
  endIndex: number;
  selectedObs: Set<string>;
  onToggleSelection: (obsId: string) => void;
  onBulkImport: () => void;
  importing: string | null;
  onImport: (obsId: string) => void;
  isAuthenticated: boolean;
  /** Availability results keyed by MAST obs_id, from checkDataAvailability. */
  availability: Record<string, DataAvailabilityItem>;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (size: number) => void;
}

/**
 * Search results table: rows, pagination, bulk-select, and per-row import
 * actions (incl. "already in library" badge and anonymous "Log in to
 * import" gating).
 *
 * Relocated from MastSearch.tsx (#1617) — behavior preserved verbatim,
 * except the "Imported" badge now reflects library availability (from
 * `checkDataAvailability`) rather than an `importedObsIds` prop.
 */
const ResultsTable: React.FC<ResultsTableProps> = ({
  searchResults,
  paginatedResults,
  startIndex,
  endIndex,
  selectedObs,
  onToggleSelection,
  onBulkImport,
  importing,
  onImport,
  isAuthenticated,
  availability,
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
}) => {
  return (
    <div className="search-results">
      <div className="results-header">
        <h3>Search Results ({searchResults.length})</h3>
        {selectedObs.size > 0 && (
          <button
            className="btn-base btn-large bulk-import-btn"
            onClick={onBulkImport}
            disabled={importing !== null}
          >
            Import Selected ({selectedObs.size})
          </button>
        )}
      </div>

      <div className="results-table-container">
        <table className="results-table">
          <thead>
            <tr>
              <th className="col-checkbox"></th>
              <th className="col-obs-id">Obs ID</th>
              <th className="col-target">Target</th>
              <th className="col-instrument">Instrument</th>
              <th className="col-filter">Filter</th>
              <th className="col-exptime">Exp Time</th>
              <th className="col-date">Obs Date</th>
              <th className="col-date">Release Date</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedResults.map((result, index) => {
              const resultObsId = result.obs_id || `result-${startIndex + index}`;
              const isAvailable = !!(result.obs_id && availability[result.obs_id]?.available);
              return (
                <tr key={resultObsId}>
                  <td className="col-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedObs.has(resultObsId)}
                      onChange={() => onToggleSelection(resultObsId)}
                      disabled={!result.obs_id}
                    />
                  </td>
                  <td className="col-obs-id" title={result.obs_id}>
                    {result.obs_id || '-'}
                  </td>
                  <td className="col-target" title={result.target_name}>
                    {result.target_name || '-'}
                  </td>
                  <td className="col-instrument">{result.instrument_name || '-'}</td>
                  <td className="col-filter" title={result.filters}>
                    {result.filters || '-'}
                  </td>
                  <td className="col-exptime">{formatExposureTime(result.t_exptime)}</td>
                  <td className="col-date">{formatDate(result.t_min)}</td>
                  <td className="col-date">{formatDate(result.t_obs_release)}</td>
                  <td className="col-actions">
                    {isAvailable ? (
                      <button className="btn-base btn-standard import-btn imported" disabled>
                        In Library
                      </button>
                    ) : !isAuthenticated ? (
                      <Link
                        to="/login"
                        className="btn-base btn-standard import-btn login-to-import"
                      >
                        Log in to import
                      </Link>
                    ) : (
                      <button
                        onClick={() => result.obs_id && onImport(result.obs_id)}
                        disabled={importing === result.obs_id || !result.obs_id}
                        className="btn-base btn-standard import-btn"
                      >
                        {importing === result.obs_id ? 'Importing...' : 'Import'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {startIndex + 1}-{Math.min(endIndex, searchResults.length)} of{' '}
            {searchResults.length} results
          </div>
          <div className="pagination-controls">
            <button
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1}
              className="btn-base btn-compact pagination-btn"
              title="First page"
            >
              ««
            </button>
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="btn-base btn-compact pagination-btn"
              title="Previous page"
            >
              «
            </button>
            <span className="pagination-pages">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="btn-base btn-compact pagination-btn"
              title="Next page"
            >
              »
            </button>
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="btn-base btn-compact pagination-btn"
              title="Last page"
            >
              »»
            </button>
          </div>
          <div className="pagination-size">
            <label htmlFor="page-size">Per page:</label>
            <select
              id="page-size"
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsTable;
