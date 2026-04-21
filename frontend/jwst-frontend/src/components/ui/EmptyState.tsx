/**
 * EmptyState — JWST Discovery design-system primitive.
 *
 * Never let a container render blank. Every empty surface gets:
 *   - muted outlined icon
 *   - one sentence of "what this is"
 *   - one sentence of "what to do about it"
 *   - one primary CTA (optional secondary ghost CTA)
 *
 * Usage:
 *   <EmptyState
 *     icon={<SearchIcon />}
 *     title="No targets match your search"
 *     description='We couldn&rsquo;t find a public JWST target for "Andromeda Cluster".'
 *     actions={
 *       <>
 *         <button className="btn-base btn-standard empty-cta-primary">Browse all targets</button>
 *         <button className="btn-base btn-standard empty-cta-ghost">Clear search</button>
 *       </>
 *     }
 *   />
 */

import type { ReactNode } from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** 'standard' for full-page containers, 'compact' for dropdowns/side panels. */
  size?: 'standard' | 'compact';
  /** Remove the dashed border (useful when the empty lives inside another card). */
  bare?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  size = 'standard',
  bare = false,
}: EmptyStateProps) {
  return (
    <div className={`empty-state empty-${size}${bare ? ' empty-bare' : ''}`} role="status">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-description">{description}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
