import React, { useState, useCallback } from 'react';
import {
  MastSearchType,
  MastSearchResponse,
  MastObservationResult,
  ImportJobStartResponse,
  ImportJobStatus,
  ImportStages
} from '../types/MastTypes';
import './MastSearch.css';

interface MastSearchProps {
  onImportComplete: () => void;
}

const API_BASE_URL = 'http://localhost:5001';
const SEARCH_TIMEOUT_MS = 120000; // 2 minutes

const MastSearch: React.FC<MastSearchProps> = ({ onImportComplete }) => {
  const [searchType, setSearchType] = useState<MastSearchType>('target');
  const [targetName, setTargetName] = useState('');
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [radius, setRadius] = useState('0.2');
  const [obsId, setObsId] = useState('');
  const [programId, setProgramId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MastObservationResult[]>([]);
  const [selectedObs, setSelectedObs] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportJobStatus | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Calculate paginated results
  const totalPages = Math.ceil(searchResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedResults = searchResults.slice(startIndex, endIndex);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSearchResults([]);
    setSelectedObs(new Set());
    setCurrentPage(1); // Reset to first page on new search

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      let endpoint = '';
      let body: Record<string, unknown> = {};

      switch (searchType) {
        case 'target':
          if (!targetName.trim()) {
            setError('Please enter a target name');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          endpoint = '/api/mast/search/target';
          body = { targetName: targetName.trim(), radius: parseFloat(radius) };
          break;
        case 'coordinates':
          if (!ra.trim() || !dec.trim()) {
            setError('Please enter both RA and Dec coordinates');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          endpoint = '/api/mast/search/coordinates';
          body = { ra: parseFloat(ra), dec: parseFloat(dec), radius: parseFloat(radius) };
          break;
        case 'observation':
          if (!obsId.trim()) {
            setError('Please enter an observation ID');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          endpoint = '/api/mast/search/observation';
          body = { obsId: obsId.trim() };
          break;
        case 'program':
          if (!programId.trim()) {
            setError('Please enter a program ID');
            setLoading(false);
            clearTimeout(timeoutId);
            return;
          }
          endpoint = '/api/mast/search/program';
          body = { programId: programId.trim() };
          break;
      }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Handle timeout errors from backend
        if (response.status === 504) {
          throw new Error('Search timed out. Try a smaller search radius or more specific search terms.');
        }
        throw new Error(errorData.details || errorData.error || 'Search failed');
      }

      const data: MastSearchResponse = await response.json();
      setSearchResults(data.results);

      if (data.results.length === 0) {
        setError('No JWST observations found matching your search criteria');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Search timed out. MAST queries can take a while for large search areas. Try a smaller radius or more specific search terms.');
      } else {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const pollImportProgress = useCallback(async (jobId: string): Promise<ImportJobStatus> => {
    const response = await fetch(`${API_BASE_URL}/api/mast/import-progress/${jobId}`);
    if (!response.ok) {
      throw new Error('Failed to get import progress');
    }
    return response.json();
  }, []);

  const handleImport = async (obsIdToImport: string) => {
    setImporting(obsIdToImport);
    setImportProgress({
      jobId: '',
      obsId: obsIdToImport,
      progress: 0,
      stage: ImportStages.Starting,
      message: 'Starting import...',
      isComplete: false,
      startedAt: new Date().toISOString()
    });

    try {
      // Start the import job
      const startResponse = await fetch(`${API_BASE_URL}/api/mast/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obsId: obsIdToImport,
          productType: 'SCIENCE',
          tags: ['mast-import']
        })
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start import');
      }

      const startData: ImportJobStartResponse = await startResponse.json();
      const jobId = startData.jobId;

      // Poll for progress
      const pollInterval = 500; // 500ms
      const maxPolls = 1200; // 10 minutes max (1200 * 500ms)
      let pollCount = 0;

      while (pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        pollCount++;

        try {
          const status = await pollImportProgress(jobId);
          setImportProgress(status);

          if (status.isComplete) {
            if (status.error) {
              // Job failed - don't close modal automatically
              break;
            } else if (status.result) {
              // Job succeeded
              if (status.result.importedCount > 0) {
                onImportComplete();
              }
              break;
            }
          }
        } catch (pollError) {
          console.error('Poll error:', pollError);
          // Continue polling even if one poll fails
        }
      }

      if (pollCount >= maxPolls) {
        setImportProgress(prev => prev ? {
          ...prev,
          stage: ImportStages.Failed,
          message: 'Import timed out. Check server logs.',
          isComplete: true,
          error: 'Import timed out after 10 minutes'
        } : null);
      }
    } catch (err) {
      setImportProgress(prev => prev ? {
        ...prev,
        stage: ImportStages.Failed,
        message: err instanceof Error ? err.message : 'Unknown error',
        isComplete: true,
        error: err instanceof Error ? err.message : 'Unknown error'
      } : null);
    } finally {
      setImporting(null);
    }
  };

  const closeProgressModal = () => {
    setImportProgress(null);
  };

  const toggleSelection = (obsIdToToggle: string) => {
    const newSelected = new Set(selectedObs);
    if (newSelected.has(obsIdToToggle)) {
      newSelected.delete(obsIdToToggle);
    } else {
      newSelected.add(obsIdToToggle);
    }
    setSelectedObs(newSelected);
  };

  const handleBulkImport = async () => {
    const obsIds = Array.from(selectedObs);
    for (const id of obsIds) {
      await handleImport(id);
    }
    setSelectedObs(new Set());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

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

  return (
    <div className="mast-search">
      <h2>MAST Portal Search</h2>
      <p className="mast-description">
        Search the Mikulski Archive for Space Telescopes (MAST) for JWST observations
      </p>

      <div className="search-type-selector">
        <label className={searchType === 'target' ? 'selected' : ''}>
          <input
            type="radio"
            value="target"
            checked={searchType === 'target'}
            onChange={() => setSearchType('target')}
          />
          Target Name
        </label>
        <label className={searchType === 'coordinates' ? 'selected' : ''}>
          <input
            type="radio"
            value="coordinates"
            checked={searchType === 'coordinates'}
            onChange={() => setSearchType('coordinates')}
          />
          Coordinates
        </label>
        <label className={searchType === 'observation' ? 'selected' : ''}>
          <input
            type="radio"
            value="observation"
            checked={searchType === 'observation'}
            onChange={() => setSearchType('observation')}
          />
          Observation ID
        </label>
        <label className={searchType === 'program' ? 'selected' : ''}>
          <input
            type="radio"
            value="program"
            checked={searchType === 'program'}
            onChange={() => setSearchType('program')}
          />
          Program ID
        </label>
      </div>

      <div className="search-inputs">
        {searchType === 'target' && (
          <>
            <input
              type="text"
              placeholder="Target name (e.g., NGC 3132, Carina Nebula)"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              onKeyPress={handleKeyPress}
              className="search-input-main"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
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
              onChange={(e) => setRa(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Dec (degrees)"
              value={dec}
              onChange={(e) => setDec(e.target.value)}
              onKeyPress={handleKeyPress}
              step="0.001"
              className="search-input-medium"
            />
            <input
              type="number"
              placeholder="Radius (deg)"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
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
            onChange={(e) => setObsId(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        {searchType === 'program' && (
          <input
            type="text"
            placeholder="Program ID (e.g., 2729)"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            onKeyPress={handleKeyPress}
            className="search-input-main"
          />
        )}

        <button
          onClick={handleSearch}
          disabled={loading}
          className={`search-button ${loading ? 'searching' : ''}`}
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

      {error && <div className="error-message">{error}</div>}

      {searchResults.length > 0 && (
        <div className="search-results">
          <div className="results-header">
            <h3>Search Results ({searchResults.length})</h3>
            {selectedObs.size > 0 && (
              <button
                className="bulk-import-btn"
                onClick={handleBulkImport}
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
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedResults.map((result, index) => {
                  const resultObsId = result.obs_id || `result-${startIndex + index}`;
                  return (
                    <tr key={resultObsId}>
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedObs.has(resultObsId)}
                          onChange={() => toggleSelection(resultObsId)}
                          disabled={!result.obs_id}
                        />
                      </td>
                      <td className="col-obs-id" title={result.obs_id}>
                        {result.obs_id || '-'}
                      </td>
                      <td className="col-target" title={result.target_name}>
                        {result.target_name || '-'}
                      </td>
                      <td className="col-instrument">
                        {result.instrument_name || '-'}
                      </td>
                      <td className="col-filter" title={result.filters}>
                        {result.filters || '-'}
                      </td>
                      <td className="col-exptime">
                        {formatExposureTime(result.t_exptime)}
                      </td>
                      <td className="col-date">
                        {formatDate(result.t_min)}
                      </td>
                      <td className="col-actions">
                        <button
                          onClick={() => result.obs_id && handleImport(result.obs_id)}
                          disabled={importing === result.obs_id || !result.obs_id}
                          className="import-btn"
                        >
                          {importing === result.obs_id ? 'Importing...' : 'Import'}
                        </button>
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
                Showing {startIndex + 1}-{Math.min(endIndex, searchResults.length)} of {searchResults.length} results
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                  title="First page"
                >
                  ««
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                  title="Previous page"
                >
                  «
                </button>
                <span className="pagination-pages">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                  title="Next page"
                >
                  »
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
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
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
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
      )}

      {/* Import Progress Modal */}
      {importProgress && (
        <div className="import-progress-overlay">
          <div className="import-progress-container">
            <div className="import-progress-header">
              <h3 className="import-progress-title">Importing from MAST</h3>
              <span className="import-progress-percent">{importProgress.progress}%</span>
            </div>

            <div className="progress-bar-container">
              <div
                className={`progress-bar-fill ${
                  importProgress.stage === ImportStages.Complete ? 'complete' :
                  importProgress.stage === ImportStages.Failed ? 'failed' : ''
                }`}
                style={{ width: `${importProgress.progress}%` }}
              />
            </div>

            <p className="import-progress-stage">
              {!importProgress.isComplete && <span className="spinner" />}
              {importProgress.message}
            </p>

            <p className="import-progress-obs-id">
              Observation: {importProgress.obsId}
            </p>

            {importProgress.error && (
              <div className="import-progress-error">
                {importProgress.error}
              </div>
            )}

            {importProgress.isComplete && !importProgress.error && importProgress.result && (
              <p className="import-progress-success">
                Successfully imported {importProgress.result.importedCount} file(s)
              </p>
            )}

            {importProgress.isComplete && (
              <button className="import-progress-close" onClick={closeProgressModal}>
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MastSearch;
