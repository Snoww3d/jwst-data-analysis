import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { SearchConsole } from '../components/discovery/SearchConsole';
import { SpotlightSection } from '../components/discovery/SpotlightSection';
import { FilterChips } from '../components/discovery/FilterChips';
import { TargetCard } from '../components/discovery/TargetCard';
import { TargetCardGrid } from '../components/discovery/TargetCardGrid';
import { TargetCardSkeletonGrid } from '../components/discovery/TargetCardSkeleton';
import { TelescopeIcon } from '../components/icons/DashboardIcons';
import { getFeaturedTargets } from '../services/discoveryService';
import { filterTargets, categoriesOf, type TargetFilter } from '../utils/filterTargets';
import type { FeaturedTarget } from '../types/DiscoveryTypes';
import './DiscoveryHome.css';

/**
 * Discovery home page — the first thing users see after login.
 * Mission-console layout: search console, "Target of the week" spotlight,
 * and a filterable featured-target grid.
 */
export function DiscoveryHome() {
  const [targets, setTargets] = useState<FeaturedTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [filter, setFilter] = useState<TargetFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadTargets() {
      try {
        setLoading(true);
        setError(null);
        const data = await getFeaturedTargets(controller.signal);
        setTargets(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load featured targets');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadTargets();
    return () => controller.abort();
  }, [retryCount]);

  useEffect(() => {
    document.title = 'Discover — JWST Discovery';
  }, []);

  const categories = useMemo(() => categoriesOf(targets), [targets]);
  const filteredTargets = useMemo(
    () => filterTargets(targets, filter, query),
    [targets, filter, query]
  );

  return (
    <div className="discovery-home">
      <SearchConsole query={query} onQueryChange={setQuery} />

      {!loading && !error && <SpotlightSection targets={targets} />}

      <section className="discovery-section" aria-labelledby="featured-targets-heading">
        <div className="discovery-section-head">
          <h2 id="featured-targets-heading" className="discovery-section-header">
            Featured targets
          </h2>
          {!loading && !error && targets.length > 0 && (
            <span className="discovery-section-count">
              {filteredTargets.length} of {targets.length} targets
            </span>
          )}
        </div>

        {!loading && !error && targets.length > 0 && (
          <FilterChips categories={categories} active={filter} onChange={setFilter} />
        )}

        {loading && <TargetCardSkeletonGrid count={13} />}

        {!loading && error && (
          <div className="discovery-error">
            <p>{error}</p>
            <button
              className="btn-base discovery-retry"
              onClick={() => setRetryCount((c) => c + 1)}
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && filteredTargets.length > 0 && (
          <TargetCardGrid>
            {filteredTargets.map((target) => (
              <TargetCard key={target.name} target={target} />
            ))}
          </TargetCardGrid>
        )}

        {!loading && !error && targets.length > 0 && filteredTargets.length === 0 && (
          <p className="discovery-no-matches">No targets match your search.</p>
        )}

        {!loading && !error && targets.length === 0 && (
          <div className="discovery-empty">
            <TelescopeIcon size={48} className="discovery-empty-icon" />
            <p>No featured targets available.</p>
            <p>
              Try searching for a target above, or visit <Link to="/library">My Library</Link> to
              work with your existing data.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
