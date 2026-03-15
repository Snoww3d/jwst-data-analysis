import { useState, useEffect } from 'react';
import JwstDataDashboard from '../components/JwstDataDashboard';
import { jwstDataService, ApiError } from '../services';
import { JwstDataModel } from '../types/JwstDataTypes';
import './MyLibrary.css';

/**
 * My Library page — wraps the existing JwstDataDashboard at /library.
 * Data fetching that previously lived in MainApp now lives here so it
 * only runs when this route is active.
 */
export function MyLibrary() {
  const [data, setData] = useState<JwstDataModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const result = await jwstDataService.getAll(true);
      setData(result);
      setError(null);
    } catch (err) {
      if (ApiError.isApiError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    try {
      const result = await jwstDataService.getAll(true);
      setData(result);
      setError(null);
    } catch {
      // Silent failure on background refresh — data stays as-is
    }
  };

  useEffect(() => {
    document.title = 'My Library — JWST Discovery';
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="library-loading">
        <h2>Loading Library...</h2>
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="library-error">
        <h2>Error</h2>
        <p>{error}</p>
        <button className="btn-base" onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="my-library">
      <div className="library-header">
        <h1 className="library-title">My Library</h1>
        <p className="library-subtitle">Your imported FITS files, composites, and mosaics</p>
      </div>
      <JwstDataDashboard data={data} onDataUpdate={refreshData} />
    </div>
  );
}
