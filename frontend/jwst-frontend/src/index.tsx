import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { clearAllCache, getCacheStats } from './utils/cacheUtils';

// Expose cache utilities on window for admin/debugging use:
//   jwst.clearCache() — clear all cached MAST/recipe data
//   jwst.cacheStats() — show cache entries and sizes
(window as unknown as Record<string, unknown>).jwst = {
  clearCache: () => {
    const count = clearAllCache();
    console.log(`Cleared ${count} cached entries. Reload the page to fetch fresh data.`);
    return count;
  },
  cacheStats: () => {
    const stats = getCacheStats();
    console.table(stats.entries);
    console.log(`Total: ${stats.entryCount} entries, ${(stats.totalBytes / 1024).toFixed(1)} KB`);
    return stats;
  },
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
