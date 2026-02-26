import './TargetCardSkeleton.css';

/**
 * Skeleton placeholder for a TargetCard while loading.
 */
export function TargetCardSkeleton() {
  return (
    <div className="target-card-skeleton" aria-hidden="true">
      <div className="skeleton-thumbnail skeleton-block" />
      <div className="skeleton-body">
        <div className="skeleton-title skeleton-block" />
        <div className="skeleton-subtitle skeleton-block" />
        <div className="skeleton-badge skeleton-block" />
      </div>
    </div>
  );
}

interface TargetCardSkeletonGridProps {
  count?: number;
}

/**
 * Grid of skeleton cards for the loading state.
 */
export function TargetCardSkeletonGrid({ count = 8 }: TargetCardSkeletonGridProps) {
  return (
    <div className="target-card-grid" role="status" aria-label="Loading featured targets">
      {Array.from({ length: count }, (_, i) => (
        <TargetCardSkeleton key={`skeleton-${i}`} />
      ))}
    </div>
  );
}
