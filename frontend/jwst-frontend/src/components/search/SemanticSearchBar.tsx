import type React from 'react';
import { useState, useCallback } from 'react';
import './SemanticSearchBar.css';

const EXAMPLE_QUERIES = [
  'long exposure NIRCam images of nebulae',
  'infrared galaxy observations',
  'raw uncalibrated detector data',
  'MIRI mid-infrared deep field',
  'calibrated mosaic science products',
  'spectral observations with NIRSpec',
];

interface SemanticSearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  totalIndexed: number;
}

export function SemanticSearchBar({ onSearch, isLoading, totalIndexed }: SemanticSearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed && !isLoading) {
        onSearch(trimmed);
      }
    },
    [query, isLoading, onSearch]
  );

  const handleExampleClick = useCallback(
    (example: string) => {
      if (isLoading) return;
      setQuery(example);
      onSearch(example);
    },
    [isLoading, onSearch]
  );

  return (
    <div className="semantic-search-bar">
      <form onSubmit={handleSubmit} className="search-form">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FITS files with natural language..."
            maxLength={500}
            disabled={isLoading}
            aria-label="Semantic search query"
          />
          <button
            type="submit"
            className="semantic-search-button"
            disabled={!query.trim() || isLoading}
            aria-label="Search"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>
      {totalIndexed === 0 && (
        <p className="search-empty-index">
          No files indexed yet. Import FITS files from MAST to enable semantic search.
        </p>
      )}
      <div className="example-queries">
        <span className="example-label">Try:</span>
        {EXAMPLE_QUERIES.map((example) => (
          <button
            key={example}
            type="button"
            className="example-chip"
            onClick={() => handleExampleClick(example)}
            disabled={isLoading}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
