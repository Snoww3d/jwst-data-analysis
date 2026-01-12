import React, { useState } from 'react';
import {
  MastSearchType,
  MastSearchResponse,
  MastObservationResult,
  MastImportResponse
} from '../types/MastTypes';
import './MastSearch.css';

interface MastSearchProps {
  onImportComplete: () => void;
}

const API_BASE_URL = 'http://localhost:5001';

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

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSearchResults([]);
    setSelectedObs(new Set());

    try {
      let endpoint = '';
      let body: Record<string, unknown> = {};

      switch (searchType) {
        case 'target':
          if (!targetName.trim()) {
            setError('Please enter a target name');
            setLoading(false);
            return;
          }
          endpoint = '/api/mast/search/target';
          body = { targetName: targetName.trim(), radius: parseFloat(radius) };
          break;
        case 'coordinates':
          if (!ra.trim() || !dec.trim()) {
            setError('Please enter both RA and Dec coordinates');
            setLoading(false);
            return;
          }
          endpoint = '/api/mast/search/coordinates';
          body = { ra: parseFloat(ra), dec: parseFloat(dec), radius: parseFloat(radius) };
          break;
        case 'observation':
          if (!obsId.trim()) {
            setError('Please enter an observation ID');
            setLoading(false);
            return;
          }
          endpoint = '/api/mast/search/observation';
          body = { obsId: obsId.trim() };
          break;
        case 'program':
          if (!programId.trim()) {
            setError('Please enter a program ID');
            setLoading(false);
            return;
          }
          endpoint = '/api/mast/search/program';
          body = { programId: programId.trim() };
          break;
      }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Search failed');
      }

      const data: MastSearchResponse = await response.json();
      setSearchResults(data.results);

      if (data.results.length === 0) {
        setError('No JWST observations found matching your search criteria');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (obsIdToImport: string) => {
    setImporting(obsIdToImport);
    try {
      const response = await fetch(`${API_BASE_URL}/api/mast/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obsId: obsIdToImport,
          productType: 'SCIENCE',
          tags: ['mast-import']
        })
      });

      const data: MastImportResponse = await response.json();

      if (data.status === 'completed' && data.importedCount > 0) {
        alert(`Successfully imported ${data.importedCount} file(s) from observation ${obsIdToImport}`);
        onImportComplete();
      } else if (data.status === 'completed' && data.importedCount === 0) {
        alert(`No science files found for observation ${obsIdToImport}`);
      } else {
        throw new Error(data.error || 'Import failed');
      }
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setImporting(null);
    }
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

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
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
          className="search-button"
        >
          {loading ? 'Searching...' : 'Search MAST'}
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
                  <th className="col-date">Date</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((result, index) => {
                  const resultObsId = result.obs_id || `result-${index}`;
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
                        {formatDate(result.t_obs_release)}
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
        </div>
      )}
    </div>
  );
};

export default MastSearch;
