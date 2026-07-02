/**
 * Global provider for the shared `useActiveImports` instance.
 *
 * A single instance lives here (mounted once in App.tsx) so the header
 * pill, MastSearch, and WhatsNewPanel all read/write the same job list
 * instead of each running independent subscriptions to the same jobs.
 */

import { createContext, type ReactNode } from 'react';
import { useActiveImports, type UseActiveImportsResult } from '../hooks/useActiveImports';

// Context must be exported for the useActiveImportsContext hook.
// eslint-disable-next-line react-refresh/only-export-components -- context must be exported for the consumer hook
export const ActiveImportsContext = createContext<UseActiveImportsResult | undefined>(undefined);

interface ActiveImportsProviderProps {
  children: ReactNode;
}

export function ActiveImportsProvider({ children }: ActiveImportsProviderProps) {
  const value = useActiveImports();
  return <ActiveImportsContext.Provider value={value}>{children}</ActiveImportsContext.Provider>;
}
