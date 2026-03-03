import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import './SearchBar.css';

/**
 * Target search bar — navigates to /target/:name on submit.
 * No autocomplete in v1 — just a direct search.
 */
export function SearchBar() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      navigate(`/target/${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <form role="search" className="discovery-search" onSubmit={handleSubmit}>
      <input
        type="search"
        className="discovery-search-field"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search targets... (Carina Nebula, M31, Pillars of Creation)"
        aria-label="Search JWST targets"
      />
      <button
        type="submit"
        className="btn-base discovery-search-btn"
        disabled={query.trim().length < 2}
        aria-label="Search"
      >
        Search
      </button>
    </form>
  );
}
