/**
 * Hook to access the shared ActiveImportsContext.
 *
 * Separated from ActiveImportsContext.tsx to satisfy the
 * react-refresh/only-export-components rule (mirrors useAuth.ts).
 */

import { use } from 'react';
import { ActiveImportsContext } from './ActiveImportsContext';
import type { UseActiveImportsResult } from '../hooks/useActiveImports';

/**
 * Hook to access the shared active-imports state.
 * Throws if used outside an ActiveImportsProvider.
 */
export function useActiveImportsContext(): UseActiveImportsResult {
  const context = use(ActiveImportsContext);
  if (!context) {
    throw new Error('useActiveImportsContext must be used within an ActiveImportsProvider');
  }
  return context;
}
