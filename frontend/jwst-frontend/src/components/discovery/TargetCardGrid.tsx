import type { ReactNode } from 'react';
import './TargetCardGrid.css';

interface TargetCardGridProps {
  children: ReactNode;
}

/**
 * Responsive CSS Grid wrapper for target cards.
 * 4 cols desktop, 3 large tablet, 2 tablet, 1 mobile.
 */
export function TargetCardGrid({ children }: TargetCardGridProps) {
  return <div className="target-card-grid">{children}</div>;
}
