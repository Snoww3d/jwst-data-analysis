import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { RecipeCard } from '../components/discovery/RecipeCard';
import { checkDataAvailability } from '../services/jwstDataService';
import { ObservationList } from '../components/discovery/ObservationList';
import { TargetDetailSkeleton } from '../components/discovery/TargetDetailSkeleton';
import { TelescopeIcon } from '../components/icons/DashboardIcons';
import { searchByTarget } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import { toObservationInputs, observationIdsForFilters } from '../utils/observationUtils';
import type { MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe } from '../types/DiscoveryTypes';
import { CE_MODE } from '../config/ce';
import { useAuth } from '../context/useAuth';
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
  // Grouping is for anonymous visitors (CE strangers): an authenticated
  // user's status pill is always "Ready" (they can download missing data),
  // so grouping would be meaningless — they keep today's flat layout and
  // per-card behavior untouched.
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const displayName = name ? decodeURIComponent(name) : 'Unknown Target';
  const radiusParam = searchParams.get('radius');
  const radius = radiusParam ? parseFloat(radiusParam) : undefined;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [observations, setObservations] = useState<MastObservationResult[]>([]);
  const [recipes, setRecipes] = useState<CompositeRecipe[]>([]);
  // Stale-while-revalidate can flip loadState to 'ready' from cached observations
  // before the recipe fetch has even started, so gate the "no recipes" empty-state
  // on a separate "at least one recipe response came back" flag to avoid showing
  // it during the pending window.
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // recipe name -> all filters available locally. null = pending or check
  // failed: render the flat ungrouped list (never present a renderable page
  // as dead because one availability call hiccuped).
  const [readyByRecipe, setReadyByRecipe] = useState<Map<string, boolean> | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTargetData() {
      setLoadState('loading');
      setErrorMessage(null);
      setRecipesLoaded(false);
      // A stale map from a previous target (or a stale-cache recipe list)
      // must never group fresh recipes — null degrades to the flat list.
      setReadyByRecipe(null);

      // ?fresh=true bypasses localStorage cache (useful when backend changes invalidate cached data)
      const freshParam = new URLSearchParams(window.location.search).get('fresh');
      const skipCache = freshParam === 'true' || freshParam === '1';

      try {
        // Step 1: Search MAST for observations (with stale-while-revalidate)
        let showedStale = false;
        // Search for Level 3 (combined/mosaic) observations only — these match
        // what GuidedCreate downloads (calibLevel: [3]). Including L1/L2 records
        // would suggest filters whose products fail at download time (#800).
        const searchResult = await searchByTarget(
          { targetName: displayName, radius, calibLevel: [3] },
          controller.signal,
          {
            skipCache,
            onStaleData: skipCache
              ? undefined
              : (staleResult) => {
                  if (controller.signal.aborted) return;
                  const staleObs = staleResult.results || [];
                  if (staleObs.length > 0) {
                    setObservations(staleObs);
                    setLoadState('ready');
                    showedStale = true;
                  }
                },
          }
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
          controller.signal,
          {
            skipCache,
            onStaleData: skipCache
              ? undefined
              : (staleRecipes) => {
                  if (controller.signal.aborted) return;
                  setRecipes(staleRecipes.recipes);
                  setRecipesLoaded(true);
                  if (!showedStale) {
                    setLoadState('ready');
                  }
                },
          }
        );

        if (controller.signal.aborted) return;

        setRecipes(recipeResponse.recipes);
        setRecipesLoaded(true);
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

  // One batched availability pass for the whole page (the service chunks at
  // the endpoint's 50-id cap). Cards render pill-less until this resolves —
  // a single reflow from flat to grouped, no per-card churn.
  useEffect(() => {
    if (isAuthenticated) return;
    if (!recipesLoaded || recipes.length === 0 || observations.length === 0) return;

    const controller = new AbortController();
    const idsPerRecipe = recipes.map((recipe) => ({
      recipe,
      obsIds: observationIdsForFilters(observations, recipe.filters),
    }));
    const unionIds = [...new Set(idsPerRecipe.flatMap((entry) => entry.obsIds))];
    if (unionIds.length === 0) return;

    checkDataAvailability(unionIds, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const availableFilters = new Set<string>();
        for (const item of Object.values(result.results)) {
          if (item?.available && item.filter) {
            availableFilters.add(item.filter.toUpperCase());
          }
        }
        const map = new Map<string, boolean>();
        for (const { recipe } of idsPerRecipe) {
          map.set(
            recipe.name,
            recipe.filters.every((f) => availableFilters.has(f.toUpperCase()))
          );
        }
        setReadyByRecipe(map);
      })
      .catch(() => {
        /* pending/failed both mean: keep the flat list, no pills */
      });

    return () => controller.abort();
  }, [recipes, recipesLoaded, observations, isAuthenticated]);

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
          <button
            className="btn-base target-detail-retry"
            onClick={() => setRetryCount((c) => c + 1)}
          >
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
            <Link to="/library">{CE_MODE ? 'the Library' : 'My Library'}</Link> to{' '}
            {CE_MODE ? 'browse the available data.' : 'work with existing data.'}
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

          {recipes.length > 0 && (isAuthenticated || readyByRecipe === null) && (
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
                    availability={isAuthenticated ? undefined : 'pending'}
                  />
                ))}
              </div>
            </section>
          )}

          {recipes.length > 0 && !isAuthenticated && readyByRecipe !== null && (
            <RecipeGroups
              recipes={recipes}
              readyByRecipe={readyByRecipe}
              displayName={displayName}
              observations={observations}
              radius={radius}
            />
          )}

          {recipes.length === 0 && !recipesLoaded && (
            <div className="target-detail-recipes-pending" role="status" aria-live="polite">
              <p>Generating recipe suggestions&hellip;</p>
            </div>
          )}

          {recipes.length === 0 && recipesLoaded && (
            <div className="target-detail-no-recipes">
              <p>
                No composite recipes could be generated for these observations. You can still{' '}
                {CE_MODE ? 'browse the data in' : 'work with the data in'}{' '}
                <Link to="/library">{CE_MODE ? 'the Library' : 'My Library'}</Link>.
              </p>
            </div>
          )}

          <ObservationList observations={observations} />
        </>
      )}
    </div>
  );
}

interface RecipeGroupsProps {
  recipes: CompositeRecipe[];
  readyByRecipe: Map<string, boolean>;
  displayName: string;
  observations: MastObservationResult[];
  radius?: number;
}

/** Ready recipes first, then the ones whose data isn't in the library.
 *  Empty groups render no header at all. */
function RecipeGroups({
  recipes,
  readyByRecipe,
  displayName,
  observations,
  radius,
}: RecipeGroupsProps) {
  const ready = recipes.filter((r) => readyByRecipe.get(r.name));
  const missing = recipes.filter((r) => !readyByRecipe.get(r.name));

  const renderCards = (group: CompositeRecipe[], availability: 'ready' | 'missing') =>
    group.map((recipe, i) => (
      <RecipeCard
        key={`${recipe.rank}-${recipe.name}`}
        recipe={recipe}
        targetName={displayName}
        isRecommended={availability === 'ready' && i === 0}
        observations={observations}
        radius={radius}
        availability={availability}
      />
    ));

  return (
    <>
      {ready.length > 0 && (
        <section className="target-detail-recipes">
          <h3 className="target-detail-section-header">Ready to render</h3>
          <div className="recipe-card-list">{renderCards(ready, 'ready')}</div>
        </section>
      )}
      {missing.length > 0 && (
        <section className="target-detail-recipes target-detail-recipes-unavailable">
          <h3 className="target-detail-section-header">Not in library</h3>
          <div className="recipe-card-list">{renderCards(missing, 'missing')}</div>
        </section>
      )}
    </>
  );
}
