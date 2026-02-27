import { Link } from 'react-router-dom';
import type { CompositeRecipe } from '../../types/DiscoveryTypes';
import './RecipeCard.css';

interface RecipeCardProps {
  recipe: CompositeRecipe;
  targetName: string;
  isRecommended?: boolean;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `~${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * A recipe card showing a suggested composite with filter chips,
 * color bars, and a CTA to start creation.
 */
export function RecipeCard({ recipe, targetName, isRecommended }: RecipeCardProps) {
  const createUrl = `/create?target=${encodeURIComponent(targetName)}&recipe=${encodeURIComponent(recipe.name)}`;

  return (
    <div className={`recipe-card ${isRecommended ? 'recipe-card-recommended' : ''}`}>
      {isRecommended && <span className="recipe-card-badge">Recommended</span>}
      <h4 className="recipe-card-name">{recipe.name}</h4>

      <div className="recipe-card-filters">
        {recipe.filters.map((filter) => (
          <span key={filter} className="recipe-filter-chip">
            <span
              className="recipe-filter-swatch"
              style={{ backgroundColor: recipe.color_mapping?.[filter] || '#666' }}
            />
            {filter}
          </span>
        ))}
      </div>

      <div className="recipe-card-color-bar">
        {recipe.filters.map((filter) => (
          <div
            key={filter}
            className="recipe-color-bar-segment"
            style={{ backgroundColor: recipe.color_mapping?.[filter] || '#666' }}
            title={filter}
          />
        ))}
      </div>

      <div className="recipe-card-meta">
        <span>{recipe.instruments.join(' + ')}</span>
        <span className="recipe-card-dot">&middot;</span>
        <span>{formatTime(recipe.estimated_time_seconds)}</span>
        {recipe.requires_mosaic && (
          <>
            <span className="recipe-card-dot">&middot;</span>
            <span className="recipe-card-mosaic">Mosaic needed</span>
          </>
        )}
      </div>

      <Link to={createUrl} className="recipe-card-cta">
        Create This Composite
      </Link>
    </div>
  );
}
