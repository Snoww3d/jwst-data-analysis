import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';
import JwstDataDashboard from './components/JwstDataDashboard';
import { ProtectedRoute } from './components/ProtectedRoute';
import { UserMenu } from './components/UserMenu';
import { LoginPage, RegisterPage } from './pages';
import { JwstDataModel } from './types/JwstDataTypes';
import { jwstDataService, ApiError } from './services';

/**
 * Main application content (after authentication)
 */
function MainApp() {
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
    fetchData();
  }, []);

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
        <div className="header-content">
          <div className="header-title">
            <h1>JWST Data Analysis Platform</h1>
            <p>Advanced computer science analysis for James Webb Space Telescope data</p>
          </div>
          <UserMenu />
        </div>
      </header>
      <main>
        <JwstDataDashboard data={data} onDataUpdate={refreshData} />
      </main>
    </div>
  );
}

/**
 * Root App component with routing
 */
function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <MainApp />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
