import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { checkDataAvailability } from '../../services/jwstDataService';
import { formatInstruments } from '../../utils/instrumentDisplay';
import { observationIdsForFilters } from '../../utils/observationUtils';
import type { CompositeRecipe } from '../../types/DiscoveryTypes';
import type { MastObservationResult } from '../../types/MastTypes';
import { CE_MODE } from '../../config/ce';
import './RecipeCard.css';

/** Parent-controlled availability: 'pending' hides the status pill. */
export type RecipeAvailability = 'ready' | 'missing' | 'pending';

interface RecipeCardProps {
  recipe: CompositeRecipe;
  targetName: string;
  isRecommended?: boolean;
  /** MAST observations available for this target — used to check data availability */
  observations?: MastObservationResult[];
  /** Optional search radius override to thread through to the guided create page */
  radius?: number;
  /**
   * When provided, the parent owns the availability check (one batched call
   * for the whole page) and the card fires no request of its own. When
   * absent, the card self-checks — standalone behavior unchanged.
   */
  availability?: RecipeAvailability;
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
export function RecipeCard({
  recipe,
  targetName,
  isRecommended,
  observations,
  radius,
  availability,
}: RecipeCardProps) {
  const { isAuthenticated } = useAuth();
  const radiusParam = radius ? `&radius=${radius}` : '';
  const createUrl = `/create?target=${encodeURIComponent(targetName)}&recipe=${encodeURIComponent(recipe.name)}${radiusParam}`;
  const [dataReady, setDataReady] = useState(false);

  // Find MAST obs_ids that match this recipe's filters (shared with
  // TargetDetail's grouped availability map so both agree)
  const obsIds = useMemo(
    () => (observations ? observationIdsForFilters(observations, recipe.filters) : []),
    [observations, recipe.filters]
  );

  // Check if all recipe filters have existing data in the library
  // (self-check mode only — skipped when the parent owns availability)
  useEffect(() => {
    if (availability !== undefined) return;
    if (obsIds.length === 0) return;

    const controller = new AbortController();

    checkDataAvailability(obsIds, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

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
        /* availability check failed or aborted — default to not ready */
      });

    return () => {
      controller.abort();
    };
  }, [obsIds, recipe.filters, availability]);

  const resolvedReady = availability !== undefined ? availability === 'ready' : dataReady;
  const showReady = resolvedReady || isAuthenticated;
  const statusPending = availability === 'pending';

  return (
    <div
      className={`recipe-card ${isRecommended ? 'recipe-card-recommended' : ''} ${recipe.tag ? 'recipe-card-curated' : ''}`}
    >
      {isRecommended && !recipe.tag && <span className="recipe-card-badge">Recommended</span>}
      {recipe.tag && (
        <span className="recipe-card-badge recipe-card-badge-curated">{recipe.tag}</span>
      )}
      <h4 className="recipe-card-name">{recipe.name}</h4>
      {recipe.description && <p className="recipe-card-description">{recipe.description}</p>}
      {recipe.overlapWarning && (
        <p className="recipe-card-overlap-warning">{recipe.overlapWarning}</p>
      )}

      <div className="recipe-card-filters">
        {recipe.filters.map((filter) => (
          <span key={filter} className="recipe-filter-chip">
            <span
              className="recipe-filter-swatch"
              style={{ backgroundColor: recipe.colorMapping?.[filter] || 'var(--text-muted)' }}
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
            style={{ backgroundColor: recipe.colorMapping?.[filter] || 'var(--text-muted)' }}
            title={filter}
          />
        ))}
      </div>

      <div className="recipe-card-meta">
        <span>{formatInstruments(recipe.instruments)}</span>
        <span className="recipe-card-dot">&middot;</span>
        <span>{formatTime(recipe.estimatedTimeSeconds)}</span>
        {recipe.requiresMosaic && (
          <>
            <span className="recipe-card-dot">&middot;</span>
            <span className="recipe-card-mosaic">Mosaic needed</span>
          </>
        )}
        {!statusPending && (
          <>
            <span className="recipe-card-dot">&middot;</span>
            {showReady ? (
              <span className="recipe-card-auth recipe-card-auth-ready">Ready</span>
            ) : CE_MODE ? (
              <span className="recipe-card-auth recipe-card-auth-login">Not in library</span>
            ) : (
              <span className="recipe-card-auth recipe-card-auth-login">Login required</span>
            )}
          </>
        )}
      </div>

      <Link to={createUrl} state={{ recipe, observations }} className="recipe-card-cta">
        Create This Composite
      </Link>
    </div>
  );
}
