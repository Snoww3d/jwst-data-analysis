import type { SemanticSearchResult } from '../../types/SearchTypes';
import './SearchResults.css';

interface SearchResultsProps {
  results: SemanticSearchResult[];
  query: string;
  embedTimeMs: number;
  searchTimeMs: number;
  totalIndexed: number;
}

function ScoreBar({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  return (
    <div className="score-bar" title={`${percent}% relevance`}>
      <div className="score-bar-fill" style={{ width: `${percent}%` }} />
      <span className="score-bar-label">{percent}%</span>
    </div>
  );
}

function ResultCard({ result }: { result: SemanticSearchResult }) {
  const thumbnailSrc = result.thumbnailData
    ? `data:image/png;base64,${result.thumbnailData}`
    : null;

  return (
    <div className="search-result-card">
      <div className="result-thumbnail">
        {thumbnailSrc ? (
          <img src={thumbnailSrc} alt={result.fileName} loading="lazy" />
        ) : (
          <div className="result-thumbnail-placeholder">No preview</div>
        )}
      </div>
      <div className="result-content">
        <div className="result-header">
          <h3 className="result-filename">{result.fileName}</h3>
          <ScoreBar score={result.score} />
        </div>
        <div className="result-metadata">
          {result.targetName && (
            <span className="result-tag">
              <span className="tag-label">Target</span> {result.targetName}
            </span>
          )}
          {result.instrument && (
            <span className="result-tag">
              <span className="tag-label">Instrument</span> {result.instrument}
            </span>
          )}
          {result.filter && (
            <span className="result-tag">
              <span className="tag-label">Filter</span> {result.filter}
            </span>
          )}
          {result.processingLevel && (
            <span className="result-tag">
              <span className="tag-label">Level</span> {result.processingLevel}
            </span>
          )}
          {result.wavelengthRange && (
            <span className="result-tag">
              <span className="tag-label">Wavelength</span> {result.wavelengthRange}
            </span>
          )}
          {result.exposureTime != null && (
            <span className="result-tag">
              <span className="tag-label">Exposure</span> {result.exposureTime.toFixed(1)}s
            </span>
          )}
        </div>
        <p className="result-matched-text">{result.matchedText}</p>
      </div>
    </div>
  );
}

export function SearchResults({
  results,
  query,
  embedTimeMs,
  searchTimeMs,
  totalIndexed,
}: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="search-results-empty">
        <p>
          No results found for &ldquo;{query}&rdquo;. Try a different query or check that files are
          indexed.
        </p>
        <p className="search-timing">
          Index contains {totalIndexed} files. Query took {embedTimeMs.toFixed(0)}ms (embed) +{' '}
          {searchTimeMs.toFixed(0)}ms (search).
        </p>
      </div>
    );
  }

  return (
    <div className="search-results">
      <div className="search-results-header">
        <span className="results-count">
          {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
        </span>
        <span className="search-timing">
          {embedTimeMs.toFixed(0)}ms embed + {searchTimeMs.toFixed(0)}ms search | {totalIndexed}{' '}
          indexed
        </span>
      </div>
      <div className="search-results-list">
        {results.map((result) => (
          <ResultCard key={result.id} result={result} />
        ))}
      </div>
    </div>
  );
}
