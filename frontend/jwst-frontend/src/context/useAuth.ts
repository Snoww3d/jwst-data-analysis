/**
 * Hook to access auth context
 *
 * Separated from AuthContext.tsx to satisfy react-refresh/only-export-components rule
 */

import { useContext } from 'react';
import { AuthContext } from './AuthContext';
import type { AuthContextType } from '../types/AuthTypes';

/**
 * Hook to access auth context
 * Throws if used outside AuthProvider
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
