import { Routes, Route } from 'react-router-dom';
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
 * Public routes: /login, /register
 * Protected routes (wrapped in SharedLayout with persistent header + nav):
 *   / — Discovery home (featured targets + search)
 *   /library — My Library (the existing dashboard, relocated)
 *   /target/:name — Target detail (observations + suggested composites)
 *   /create — Guided creation flow (download → process → result)
 */
function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <ProtectedRoute>
            <SharedLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DiscoveryHome />} />
        <Route path="library" element={<MyLibrary />} />
        <Route path="target/:name" element={<TargetDetail />} />
        <Route path="create" element={<GuidedCreate />} />
      </Route>
    </Routes>
  );
}

export default App;
