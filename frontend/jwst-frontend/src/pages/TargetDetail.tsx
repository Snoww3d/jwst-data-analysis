import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { RecipeCard } from '../components/discovery/RecipeCard';
import { ObservationList } from '../components/discovery/ObservationList';
import { TargetDetailSkeleton } from '../components/discovery/TargetDetailSkeleton';
import { TelescopeIcon } from '../components/icons/DashboardIcons';
import { searchByTarget } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import { toObservationInputs } from '../utils/observationUtils';
import type { MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe } from '../types/DiscoveryTypes';
import './TargetDetail.css';

type LoadState = 'loading' | 'ready' | 'error' | 'empty';

/**
 * Target detail page — shows available observations and suggested composites.
 *
 * Flow:
 * 1. Search MAST for the target name
 * 2. Pass observations to the recipe engine for suggestions
 * 3. Display recipe cards + collapsible observation list
 */
export function TargetDetail() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const displayName = name ? decodeURIComponent(name) : 'Unknown Target';
  const radius = searchParams.get('radius') ? parseFloat(searchParams.get('radius')!) : undefined;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [observations, setObservations] = useState<MastObservationResult[]>([]);
  const [recipes, setRecipes] = useState<CompositeRecipe[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTargetData() {
      setLoadState('loading');
      setErrorMessage(null);

      try {
        // Step 1: Search MAST for observations
        const searchResult = await searchByTarget(
          { targetName: displayName, radius },
          controller.signal
        );

        if (controller.signal.aborted) return;

        const obs = searchResult.results || [];
        setObservations(obs);

        if (obs.length === 0) {
          setLoadState('empty');
          return;
        }

        // Step 2: Get recipe suggestions from the observation set
        const inputs = toObservationInputs(obs);
        if (inputs.length === 0) {
          setLoadState('empty');
          return;
        }

        const recipeResponse = await suggestRecipes(
          { targetName: displayName, observations: inputs },
          controller.signal
        );

        if (controller.signal.aborted) return;

        setRecipes(recipeResponse.recipes);
        setLoadState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load target data');
        setLoadState('error');
      }
    }

    loadTargetData();
    return () => controller.abort();
  }, [displayName, radius, retryCount]);

  return (
    <div className="target-detail">
      <div className="target-detail-back">
        <Link to="/" className="back-link">
          &larr; Back to Discovery
        </Link>
      </div>

      <h2>{displayName}</h2>

      {loadState === 'loading' && <TargetDetailSkeleton />}

      {loadState === 'error' && (
        <div className="target-detail-error">
          <p>{errorMessage || 'Something went wrong.'}</p>
          <button className="target-detail-retry" onClick={() => setRetryCount((c) => c + 1)}>
            Try Again
          </button>
        </div>
      )}

      {loadState === 'empty' && (
        <div className="target-detail-empty">
          <TelescopeIcon size={48} />
          <p>No observations found for this target.</p>
          <p className="target-detail-empty-hint">
            Try searching with a different name or catalog ID, or visit{' '}
            <Link to="/library">My Library</Link> to work with existing data.
          </p>
        </div>
      )}

      {loadState === 'ready' && (
        <>
          <p className="target-detail-summary">
            {observations.length} observation{observations.length !== 1 ? 's' : ''} found
            {recipes.length > 0 &&
              ` \u00b7 ${recipes.length} composite recipe${recipes.length !== 1 ? 's' : ''} suggested`}
          </p>

          {recipes.length > 0 && (
            <section className="target-detail-recipes">
              <h3 className="target-detail-section-header">Suggested Composites</h3>
              <div className="recipe-card-list">
                {recipes.map((recipe, i) => (
                  <RecipeCard
                    key={`${recipe.rank}-${recipe.name}`}
                    recipe={recipe}
                    targetName={displayName}
                    isRecommended={i === 0}
                    observations={observations}
                    radius={radius}
                  />
                ))}
              </div>
            </section>
          )}

          {recipes.length === 0 && (
            <div className="target-detail-no-recipes">
              <p>
                No composite recipes could be generated for these observations. You can still work
                with the data in <Link to="/library">My Library</Link>.
              </p>
            </div>
          )}

          <ObservationList observations={observations} />
        </>
      )}
    </div>
  );
}
