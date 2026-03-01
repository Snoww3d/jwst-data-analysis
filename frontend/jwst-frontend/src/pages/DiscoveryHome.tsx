import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/discovery/SearchBar';
import { TargetCard } from '../components/discovery/TargetCard';
import { TargetCardGrid } from '../components/discovery/TargetCardGrid';
import { TargetCardSkeletonGrid } from '../components/discovery/TargetCardSkeleton';
import { TelescopeIcon } from '../components/icons/DashboardIcons';
import { getFeaturedTargets } from '../services/discoveryService';
import type { FeaturedTarget } from '../types/DiscoveryTypes';
import './DiscoveryHome.css';

/**
 * Discovery home page — the first thing users see after login.
 * Shows featured JWST targets and a search bar to find any target.
 */
export function DiscoveryHome() {
  const [targets, setTargets] = useState<FeaturedTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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

  return (
    <div className="discovery-home">
      <div className="discovery-hero">
        <h2>Explore the Universe Through Webb's Eyes</h2>
        <p className="discovery-hero-sub">Choose a target and create your own composite image</p>
        <SearchBar />
      </div>

      <section className="discovery-section">
        <h3 className="discovery-section-header">Featured Targets</h3>

        {loading && <TargetCardSkeletonGrid count={13} />}

        {!loading && error && (
          <div className="discovery-error">
            <p>{error}</p>
            <button className="discovery-retry" onClick={() => setRetryCount((c) => c + 1)}>
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && targets.length > 0 && (
          <TargetCardGrid>
            {targets.map((target) => (
              <TargetCard key={target.name} target={target} />
            ))}
          </TargetCardGrid>
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
