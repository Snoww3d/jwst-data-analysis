import { type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon } from '../icons/DashboardIcons';
import './SearchConsole.css';

interface SearchConsoleProps {
  query: string;
  onQueryChange: (query: string) => void;
}

const EXAMPLE_QUERIES = ['M16', 'NGC 3324', '10h 37m -58°', 'PID 2739'];

/**
 * Command-style search console: eyebrow + headline + search field + example chips.
 * Typing filters the featured grid live; submitting navigates to the target
 * detail / MAST search flow (same behavior as the previous SearchBar).
 */
export function SearchConsole({ query, onQueryChange }: SearchConsoleProps) {
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      navigate(`/target/${encodeURIComponent(trimmed)}`);
    }
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
