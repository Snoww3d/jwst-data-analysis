import React, { useEffect, useId, useState } from 'react';
import {
  parseSearchQuery,
  describeParsedQuery,
  type ParsedQuery,
} from '../../utils/searchQueryParser';
import type { RecentSearch } from '../../utils/recentSearches';
import './SmartSearchInput.css';

const HINT_DEBOUNCE_MS = 150;

interface SmartSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  radius: string;
  onRadiusChange: (value: string) => void;
  showAllCalibLevels: boolean;
  onShowAllCalibLevelsChange: (value: boolean) => void;
  loading: boolean;
  recents: RecentSearch[];
  onSubmit: (query: string, radius: string) => void;
}

/** Radius only means something for a cone search. */
function usesRadius(parsed: ParsedQuery): boolean {
  return parsed.kind === 'target' || parsed.kind === 'coords';
}

/**
 * One text box for every MAST search mode. The query is parsed as the user
 * types (target name / coordinates / observation ID / program ID) and the
 * interpretation is shown beneath the field, so the user never has to pick
 * a mode first. Replaces the four-radio SearchForm (MAST Search v2, Phase 2).
 */
const SmartSearchInput: React.FC<SmartSearchInputProps> = ({
  value,
  onChange,
  radius,
  onRadiusChange,
  showAllCalibLevels,
  onShowAllCalibLevelsChange,
  loading,
  recents,
  onSubmit,
}) => {
  const hintId = useId();
  // Debounced so the hint does not flicker through intermediate
  // interpretations mid-keystroke ("1" is a target, "10 3" is coordinates…).
  const [parsed, setParsed] = useState<ParsedQuery>(() => parseSearchQuery(value));
  useEffect(() => {
    const t = setTimeout(() => setParsed(parseSearchQuery(value)), HINT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const hint = describeParsedQuery(parsed);

  const submit = () => onSubmit(value, radius);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="smart-search">
      <div className="smart-search-row">
        <input
          type="text"
          placeholder="Target name, coordinates, observation ID, or program ID"
          aria-label="Search MAST"
          aria-describedby={hintId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="smart-search-input"
          autoComplete="off"
          spellCheck={false}
        />
        {usesRadius(parsed) && (
          <label className="smart-search-radius">
            <span className="smart-search-radius-label">Radius</span>
            <input
              type="number"
              aria-label="Search radius (degrees)"
              value={radius}
              onChange={(e) => onRadiusChange(e.target.value)}
              onKeyDown={handleKeyDown}
              step="0.1"
              min="0.01"
              max="10"
            />
            <span className="smart-search-radius-unit">deg</span>
          </label>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className={`btn-base btn-large search-button ${loading ? 'searching' : ''}`}
        >
          {loading ? (
            <>
              <span className="search-spinner" />
              Searching MAST...
            </>
          ) : (
            'Search MAST'
          )}
        </button>
      </div>

      {/* Always mounted so assistive tech announces changes; empty until the
          user has typed something. */}
      <p id={hintId} className="smart-search-hint" aria-live="polite">
        {hint || 'Type a target name, RA/Dec, an observation ID (jw…), or a program ID.'}
      </p>

      <div className="smart-search-options">
        {parsed.kind !== 'obsId' && (
          <label className="calib-level-toggle">
            <input
              type="checkbox"
              checked={showAllCalibLevels}
              onChange={(e) => onShowAllCalibLevelsChange(e.target.checked)}
            />
            <span className="toggle-label">Include raw &amp; part-processed data</span>
            {/* Says what it is FOR. "Show all calibration levels" described the
                mechanism and left the reason unstated, so nobody turned it on
                and there was never anything to calibrate (#1760). */}
            <span className="toggle-hint">
              {showAllCalibLevels
                ? '(Levels 1–3: the exposures you can process yourself)'
                : '(Level 3 only: images already combined for you)'}
            </span>
          </label>
        )}
      </div>

      {recents.length > 0 && (
        <div className="smart-search-recents" aria-label="Recent searches">
          <span className="smart-search-recents-label">Recent</span>
          {recents.map((r) => (
            <button
              key={`${r.q}|${r.r}`}
              type="button"
              className="smart-search-recent-chip"
              onClick={() => {
                onChange(r.q);
                onRadiusChange(r.r);
                onSubmit(r.q, r.r);
              }}
              disabled={loading}
              title={`Search again: ${r.q}`}
            >
              {r.q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SmartSearchInput;
