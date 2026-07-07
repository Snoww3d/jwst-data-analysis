import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { ProtectedRoute } from './components/ProtectedRoute';
import { CE_MODE } from './config/ce';
import { SharedLayout } from './components/layout/SharedLayout';
import { ToastProvider } from './components/ui/toast';
import { ActiveImportsProvider } from './context/ActiveImportsContext';

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
const ArchivePage = lazy(() =>
  import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage }))
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
      <ToastProvider position="bottom-right" />
      <ActiveImportsProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            {/* CE has no accounts: auth pages are not routed at all */}
            {!CE_MODE && <Route path="/login" element={<LoginPage />} />}
            {!CE_MODE && <Route path="/register" element={<RegisterPage />} />}
            {/* Public discovery pages — no login required to browse */}
            <Route element={<SharedLayout />}>
              <Route index element={<DiscoveryHome />} />
              <Route path="target/:name" element={<TargetDetail />} />
              <Route path="create" element={<GuidedCreate />} />
              {/* semantic search is out of CE v1 (its API never mounts) */}
              {!CE_MODE && <Route path="search" element={<SearchPage />} />}
              <Route path="archive" element={<ArchivePage />} />
              {/* CE review decision 2026-07-06: /library is a public
                  read-only view — mutations are gated inside the dashboard */}
              {CE_MODE && <Route path="library" element={<MyLibrary />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
            {/* Protected pages — login required (never routed in CE) */}
            {!CE_MODE && (
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
            )}
          </Routes>
        </Suspense>
      </ActiveImportsProvider>
    </>
  );
}

export default App;
