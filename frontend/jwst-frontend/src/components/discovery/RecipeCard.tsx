import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { checkDataAvailability } from '../../services/jwstDataService';
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
  const { isAuthenticated } = useAuth();
  const createUrl = `/create?target=${encodeURIComponent(targetName)}&recipe=${encodeURIComponent(recipe.name)}`;
  const [dataReady, setDataReady] = useState(false);

  const obsIds = recipe.observationIds;

  // Check if all recipe filters have existing data in the library
  useEffect(() => {
    if (!obsIds || obsIds.length === 0) return;

    let cancelled = false;

    checkDataAvailability(obsIds)
      .then((result) => {
        if (cancelled) return;

        // Check if every filter in the recipe has available data
        const recipeFilters = new Set(recipe.filters.map((f) => f.toUpperCase()));
        const availableFilters = new Set<string>();

        for (const id of obsIds) {
          const item = result.results[id];
          if (item?.available && item.filter) {
            availableFilters.add(item.filter.toUpperCase());
          }
        }

        const allReady = [...recipeFilters].every((f) => availableFilters.has(f));
        setDataReady(allReady);
      })
      .catch(() => {
        /* availability check failed — default to not ready */
      });

    return () => {
      cancelled = true;
    };
  }, [obsIds, recipe.filters]);

  const showReady = dataReady || isAuthenticated;

  return (
    <div className={`recipe-card ${isRecommended ? 'recipe-card-recommended' : ''}`}>
      {isRecommended && <span className="recipe-card-badge">Recommended</span>}
      <h4 className="recipe-card-name">{recipe.name}</h4>

      <div className="recipe-card-filters">
        {recipe.filters.map((filter) => (
          <span key={filter} className="recipe-filter-chip">
            <span
              className="recipe-filter-swatch"
              style={{ backgroundColor: recipe.colorMapping?.[filter] || '#666' }}
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
            style={{ backgroundColor: recipe.colorMapping?.[filter] || '#666' }}
            title={filter}
          />
        ))}
      </div>

      <div className="recipe-card-meta">
        <span>{recipe.instruments.join(' + ')}</span>
        <span className="recipe-card-dot">&middot;</span>
        <span>{formatTime(recipe.estimatedTimeSeconds)}</span>
        {recipe.requiresMosaic && (
          <>
            <span className="recipe-card-dot">&middot;</span>
            <span className="recipe-card-mosaic">Mosaic needed</span>
          </>
        )}
        <span className="recipe-card-dot">&middot;</span>
        {showReady ? (
          <span className="recipe-card-auth recipe-card-auth-ready">Ready</span>
        ) : (
          <span className="recipe-card-auth recipe-card-auth-login">Login required</span>
        )}
      </div>

      <Link to={createUrl} className="recipe-card-cta">
        Create This Composite
      </Link>
    </div>
  );
}
