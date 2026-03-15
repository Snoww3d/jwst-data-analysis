import { useState, useEffect, useCallback, useRef } from 'react';
import { SemanticSearchBar } from '../components/search/SemanticSearchBar';
import { SearchResults } from '../components/search/SearchResults';
import { semanticSearch, getIndexStatus, triggerReindex } from '../services/semanticSearchService';
import { useAuth } from '../context/useAuth';
import type { SemanticSearchResponse, IndexStatusResponse } from '../types/SearchTypes';
import './SearchPage.css';

export function SearchPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  const [searchResponse, setSearchResponse] = useState<SemanticSearchResponse | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);
  const reindexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = 'Search — JWST Discovery';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getIndexStatus(controller.signal)
      .then(setIndexStatus)
      .catch(() => {
        /* engine may be loading */
      });
    return () => {
      controller.abort();
      searchAbortRef.current?.abort();
      if (reindexTimeoutRef.current) clearTimeout(reindexTimeoutRef.current);
    };
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    // Cancel any in-flight search
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setError(null);
    try {
      const response = await semanticSearch(query, 20, 0.3, controller.signal);
      if (!controller.signal.aborted) {
        setSearchResponse(response);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, []);

  const handleReindex = useCallback(async () => {
    setIsReindexing(true);
    setError(null);
    try {
      await triggerReindex();
      // Refresh index status after a short delay
      reindexTimeoutRef.current = setTimeout(async () => {
        try {
          const status = await getIndexStatus();
          setIndexStatus(status);
        } catch {
          /* ignore */
        }
        setIsReindexing(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-index failed');
      setIsReindexing(false);
    }
  }, []);

  return (
    <div className="search-page">
      <div className="search-page-header">
        <div className="search-title-row">
          <h1 className="search-title">Semantic Search</h1>
          {indexStatus && (
            <span
              className={`index-badge ${indexStatus.totalIndexed > 0 ? 'index-badge-active' : 'index-badge-empty'}`}
            >
              {indexStatus.totalIndexed} indexed
            </span>
          )}
        </div>
        <p className="search-subtitle">
          Search FITS files using natural language. Powered by sentence embeddings and vector
          similarity.
        </p>
        <div className="search-actions">
          <button
            type="button"
            className="how-it-works-toggle"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
          >
            {showHowItWorks ? 'Hide' : 'How it works'}
          </button>
          {isAdmin && (
            <button
              type="button"
              className="reindex-button"
              onClick={handleReindex}
              disabled={isReindexing}
            >
              {isReindexing ? 'Re-indexing...' : 'Re-index All'}
            </button>
          )}
        </div>
      </div>

      {showHowItWorks && (
        <div className="how-it-works">
          <h3>How Semantic Search Works</h3>
          <ol>
            <li>
              <strong>Text Building</strong> &mdash; FITS metadata (target, instrument, filter,
              exposure, wavelength) is transformed into natural language prose.
            </li>
            <li>
              <strong>Embedding</strong> &mdash; Both the metadata text and your query are converted
              into 384-dimensional vectors using the MiniLM sentence transformer model.
            </li>
            <li>
              <strong>Vector Search</strong> &mdash; FAISS finds the most similar metadata vectors
              to your query vector using cosine similarity.
            </li>
            <li>
              <strong>Enrichment</strong> &mdash; Results are enriched with full metadata and
              thumbnails from the database.
            </li>
          </ol>
          <p>
            This means queries like &ldquo;deep exposure infrared nebula&rdquo; match files with
            high exposure times, infrared wavelengths, and nebula targets &mdash; even if those
            exact words don&apos;t appear in the metadata.
          </p>
        </div>
      )}

      <SemanticSearchBar
        onSearch={handleSearch}
        isLoading={isSearching}
        totalIndexed={indexStatus?.totalIndexed ?? 0}
      />

      {error && (
        <div className="search-error" role="alert">
          {error}
        </div>
      )}

      <div aria-busy={isSearching} aria-live="polite">
        {searchResponse && (
          <SearchResults
            results={searchResponse.results}
            query={searchResponse.query}
            embedTimeMs={searchResponse.embedTimeMs}
            searchTimeMs={searchResponse.searchTimeMs}
            totalIndexed={searchResponse.totalIndexed}
          />
        )}
      </div>
    </div>
  );
}
