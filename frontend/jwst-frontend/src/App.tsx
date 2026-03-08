import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import './App.css';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SharedLayout } from './components/layout/SharedLayout';
import {
  LoginPage,
  RegisterPage,
  DiscoveryHome,
  MyLibrary,
  TargetDetail,
  GuidedCreate,
  CompositePage,
  MosaicPage,
  SearchPage,
} from './pages';

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
    </>
  );
}

export default App;
