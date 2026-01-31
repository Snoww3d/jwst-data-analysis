import { useState, useEffect } from 'react';
import './App.css';
import JwstDataDashboard from './components/JwstDataDashboard';
import { JwstDataModel } from './types/JwstDataTypes';
import { jwstDataService, ApiError } from './services';

function App() {
  const [data, setData] = useState<JwstDataModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

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

  if (loading) {
    return (
      <div className="App">
        <div className="loading">
          <h2>Loading JWST Data Analysis Dashboard...</h2>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>JWST Data Analysis Platform</h1>
        <p>Advanced computer science analysis for James Webb Space Telescope data</p>
      </header>
      <main>
        <JwstDataDashboard data={data} onDataUpdate={fetchData} />
      </main>
    </div>
  );
}

export default App;
