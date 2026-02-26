import './TargetDetailSkeleton.css';

/**
 * Skeleton placeholder for a recipe card while loading.
 */
function RecipeCardSkeleton() {
  return (
    <div className="recipe-card-skeleton" aria-hidden="true">
      <div className="skeleton-block skeleton-recipe-name" />
      <div className="skeleton-recipe-chips">
        <div className="skeleton-block skeleton-chip" />
        <div className="skeleton-block skeleton-chip" />
        <div className="skeleton-block skeleton-chip" />
      </div>
      <div className="skeleton-block skeleton-color-bar" />
      <div className="skeleton-block skeleton-recipe-meta" />
      <div className="skeleton-block skeleton-recipe-cta" />
    </div>
  );
}

/**
 * Full-page skeleton for the target detail page while loading.
 * Shows placeholder header + 2 recipe card skeletons.
 */
export function TargetDetailSkeleton() {
  return (
    <div className="target-detail-skeleton" role="status" aria-label="Loading target details">
      <div className="skeleton-block skeleton-back-link" />
      <div className="skeleton-block skeleton-target-name" />
      <div className="skeleton-block skeleton-target-sub" />
      <div className="skeleton-section-header">
        <div className="skeleton-block skeleton-section-title" />
      </div>
      <RecipeCardSkeleton />
      <RecipeCardSkeleton />
    </div>
  );
}
