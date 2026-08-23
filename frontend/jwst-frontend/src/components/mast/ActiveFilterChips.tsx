import React from 'react';
import type { ActiveChip } from '../../utils/mastCriteria';
import './ActiveFilterChips.css';

interface ActiveFilterChipsProps {
  chips: ActiveChip[];
  /** Remove one applied filter (applies immediately — it is one deliberate click). */
  onRemove: (key: string) => void;
  disabled?: boolean;
}

/**
 * The applied facets, above the results, as chips — monospace, uppercase,
 * coloured swatch dot (design rule). The widened release window is shown but
 * not removable: only a date range replaces it.
 */
const ActiveFilterChips: React.FC<ActiveFilterChipsProps> = ({ chips, onRemove, disabled }) => {
  if (chips.length === 0) return null;
  return (
    <div className="facet-chips" role="list" aria-label="Active filters">
      {chips.map((chip) => (
        <span key={chip.key} role="listitem" className="facet-chip" data-kind={chip.kind}>
          <span className="facet-chip-swatch" aria-hidden="true" />
          <span className="facet-chip-label">{chip.label}</span>
          {chip.removable ? (
            <button
              type="button"
              className="facet-chip-remove"
              aria-label={`Remove filter ${chip.label}`}
              onClick={() => onRemove(chip.key)}
              disabled={disabled}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span
              className="facet-chip-lock"
              title="Set an observation date range in Filters to search further back"
              aria-hidden="true"
            />
          )}
        </span>
      ))}
    </div>
  );
};

export default ActiveFilterChips;
