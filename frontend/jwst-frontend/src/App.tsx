import { Routes, Route, Navigate } from 'react-router-dom';
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* Public discovery pages — no login required to browse */}
      <Route element={<SharedLayout />}>
        <Route index element={<DiscoveryHome />} />
        <Route path="target/:name" element={<TargetDetail />} />
        <Route path="create" element={<GuidedCreate />} />
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
      </Route>
    </Routes>
  );
}

export default App;
