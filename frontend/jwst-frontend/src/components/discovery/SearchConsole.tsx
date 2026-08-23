import { type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon } from '../icons/DashboardIcons';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';
import { filterTargets } from '../../utils/filterTargets';
import { DEFAULT_SEARCH_RADIUS } from '../../hooks/useSearchUrlState';
import './SearchConsole.css';

interface SearchConsoleProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Featured targets; a query naming one goes to its detail page. */
  targets: FeaturedTarget[];
}

const EXAMPLE_QUERIES = ['M16', 'NGC 3324', '10h 37m -58°', 'PID 2739'];

/**
 * The featured target the query names, if any: an exact (case-insensitive)
 * name or catalog-ID match wins; otherwise the query must narrow the grid to
 * exactly one card. Anything looser would send "ngc" to a target page.
 */
function matchFeaturedTarget(targets: FeaturedTarget[], query: string): FeaturedTarget | null {
  const matches = filterTargets(targets, 'all', query);
  const q = query.toLowerCase();
  const exact = matches.find((t) => t.name.toLowerCase() === q || t.catalogId?.toLowerCase() === q);
  if (exact) return exact;
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Command-style search console: eyebrow + headline + search field + example chips.
 * Typing filters the featured grid live. Submitting a featured target's name
 * opens its detail page; anything else (coordinates, a program ID, an
 * unknown name) goes to the MAST search page, which parses the text the same
 * way the chips promise (MAST Search v2, Phase 2).
 */
export function SearchConsole({ query, onQueryChange, targets }: SearchConsoleProps) {
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const hit = matchFeaturedTarget(targets, trimmed);
    if (hit) {
      // Same link the TargetCard builds, so both routes land identically.
      const slug = encodeURIComponent(hit.mastSearchParams.target);
      const radius = hit.mastSearchParams.searchRadius;
      navigate(`/target/${slug}${radius ? `?radius=${radius}` : ''}`);
      return;
    }
    const params = new URLSearchParams({ q: trimmed, r: DEFAULT_SEARCH_RADIUS });
    navigate(`/search?${params.toString()}`);
  };

  return (
    <section className="search-console" aria-labelledby="search-console-title">
      <p className="search-console-eyebrow">Discover</p>
      <h1 id="search-console-title" className="search-console-title">
        Explore the universe through Webb&rsquo;s eyes.
      </h1>
      <p className="search-console-subtitle">
        Search public JWST observations by target name, coordinates, or program ID &mdash; then turn
        raw FITS into a false-color composite.
      </p>
      <form role="search" className="discovery-search" onSubmit={handleSubmit}>
        <SearchIcon size={20} className="discovery-search-icon" />
        <input
          type="search"
          className="discovery-search-field"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by name, catalog ID, coordinates, or program ID…"
          aria-label="Search JWST targets"
        />
        <button
          type="submit"
          className="btn-base discovery-search-btn"
          disabled={query.trim().length < 2}
        >
          Search
        </button>
      </form>
      <div className="search-console-examples">
        <span className="search-console-examples-label">Try</span>
        {EXAMPLE_QUERIES.map((example) => (
          <button
            key={example}
            type="button"
            className="search-console-example-chip"
            onClick={() => onQueryChange(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );
}
