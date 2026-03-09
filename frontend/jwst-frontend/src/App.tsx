import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import './App.css';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SharedLayout } from './components/layout/SharedLayout';

/**
 * Route-level code splitting — each page loads its own chunk on demand.
 *
 * MyLibrary imports JwstDataDashboard → SpectralViewer → react-plotly.js,
 * so lazy-loading these routes keeps the plotly chunk (~4.9 MB / 1.5 MB gzip)
 * off the initial bundle for users who never visit /library.
 *
 * CompositePage and MosaicPage are similarly heavy (wizard + image processing
 * logic) and benefit from being split into their own chunks.
 */
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);
const DiscoveryHome = lazy(() =>
  import('./pages/DiscoveryHome').then((m) => ({ default: m.DiscoveryHome }))
);
const MyLibrary = lazy(() => import('./pages/MyLibrary').then((m) => ({ default: m.MyLibrary })));
const TargetDetail = lazy(() =>
  import('./pages/TargetDetail').then((m) => ({ default: m.TargetDetail }))
);
const GuidedCreate = lazy(() =>
  import('./pages/GuidedCreate').then((m) => ({ default: m.GuidedCreate }))
);
const CompositePage = lazy(() =>
  import('./pages/CompositePage').then((m) => ({ default: m.CompositePage }))
);
const MosaicPage = lazy(() =>
  import('./pages/MosaicPage').then((m) => ({ default: m.MosaicPage }))
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage }))
);

/** Minimal full-screen spinner shown while a route chunk is fetching. */
function PageLoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-base, #0f0f23)',
      }}
    >
      <div className="spinner" aria-label="Loading page" />
    </div>
  );
}

/**
 * Root App component with routing.
 *
 * Public routes: /login, /register, and discovery/browse pages
 * Protected routes: /library (requires login)
 *
 * The SharedLayout (header + nav) wraps all authenticated and public pages.
 * GuidedCreate gates the import action itself, not the page load.
 */
function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Public discovery pages — no login required to browse */}
          <Route element={<SharedLayout />}>
            <Route index element={<DiscoveryHome />} />
            <Route path="target/:name" element={<TargetDetail />} />
            <Route path="create" element={<GuidedCreate />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          {/* Protected pages — login required */}
          <Route
            element={
              <ProtectedRoute>
                <SharedLayout />
              </ProtectedRoute>
            }
          >
            <Route path="library" element={<MyLibrary />} />
            <Route path="composite" element={<CompositePage />} />
            <Route path="mosaic" element={<MosaicPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
