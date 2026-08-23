import React, { useId, useMemo, useState } from 'react';
import {
  CALIB_LEVELS,
  DATAPRODUCT_TYPES,
  EMPTY_FACETS,
  INSTRUMENTS,
  INSTRUMENT_MODES,
  facetsEqual,
  type FacetState,
  type Intent,
} from '../../utils/mastCriteria';
import { normalizeInstrument } from '../../utils/instrumentDisplay';
import { FILTER_PRESETS } from '../../utils/filterPresets';
import './FilterRail.css';

interface FilterRailProps {
  /** The draft the rail edits (not yet applied). */
  value: FacetState;
  onChange: (next: FacetState) => void;
  /** Apply pushes the URL; the page runs the search from there. */
  onApply: () => void;
  /** Reset the draft (and, if anything was applied, apply the reset). */
  onClear: () => void;
  /** The facets currently applied (in the URL) — Apply is disabled when unchanged. */
  applied: FacetState;
  loading: boolean;
  /** The typed query is an observation / program ID: facets are not sent. */
  idLookup: boolean;
}

const FILTER_NAME_RE = /^[A-Z0-9_.*-]+$/;
const MAX_FILTERS = 20;

/** Preset filter names grouped by instrument base name, from the composite presets. */
function presetFiltersFor(instruments: string[]): string[] {
  const wanted = new Set(instruments.map(normalizeInstrument));
  const anyInstrument = wanted.size === 0;
  const names = new Set<string>();
  for (const preset of FILTER_PRESETS) {
    if (preset.instrument === 'Mixed') continue;
    if (!anyInstrument && !wanted.has(preset.instrument)) continue;
    for (const f of preset.filters) names.add(f.name);
  }
  return [...names].sort();
}

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort();
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  /** Short status shown in the header when collapsed (e.g. "2 selected"). */
  summary?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, defaultOpen = true, summary, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="filter-rail-section">
      <button
        type="button"
        className="filter-rail-section-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filter-rail-section-title">{title}</span>
        {!open && summary && <span className="filter-rail-section-summary">{summary}</span>}
        <span className={`filter-rail-chevron ${open ? 'open' : ''}`} aria-hidden="true" />
      </button>
      <div id={id} className="filter-rail-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
};

/**
 * Left rail of facets for the MAST search (MAST Search v2 Phase 4). Edits a
 * DRAFT; nothing is queried until Apply (CE rate-limits MAST at 2 r/s, and a
 * rail that searches on every click would burn through that). With an empty
 * query, Apply runs a facet-only search.
 */
const FilterRail: React.FC<FilterRailProps> = ({
  value,
  onChange,
  onApply,
  onClear,
  applied,
  loading,
  idLookup,
}) => {
  const [filterText, setFilterText] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const presets = useMemo(() => presetFiltersFor(value.instruments), [value.instruments]);
  const unchanged = facetsEqual(value, applied);
  const isEmptyDraft = facetsEqual(value, EMPTY_FACETS);

  const update = (patch: Partial<FacetState>) => onChange({ ...value, ...patch });

  const addFilter = () => {
    const name = filterText.trim().toUpperCase();
    if (!name) return;
    if (!FILTER_NAME_RE.test(name)) {
      setFilterError('Filter names use letters, digits, . _ - and *');
      return;
    }
    if (value.filters.length >= MAX_FILTERS && !value.filters.includes(name)) {
      setFilterError(`At most ${MAX_FILTERS} filters`);
      return;
    }
    setFilterError(null);
    setFilterText('');
    if (!value.filters.includes(name)) update({ filters: [...value.filters, name].sort() });
  };

  const toggleCalib = (level: number) => {
    const has = value.calibLevels.includes(level);
    // at least one level stays on — an empty list would mean "all" server-side
    if (has && value.calibLevels.length === 1) return;
    const next = has
      ? value.calibLevels.filter((l) => l !== level)
      : [...value.calibLevels, level].sort((a, b) => a - b);
    update({ calibLevels: next });
  };

  // Every filter the user can see as a toggle: presets for the chosen
  // instruments plus anything typed in by hand.
  const filterChoices = useMemo(
    () => [...new Set([...presets, ...value.filters])].sort(),
    [presets, value.filters]
  );

  const instrumentSummary = value.instruments.length
    ? value.instruments.map(normalizeInstrument).join(', ')
    : undefined;

  return (
    <aside className="filter-rail" aria-label="Search filters">
      <div className="filter-rail-header">
        <h3 className="filter-rail-heading">Filters</h3>
        <button
          type="button"
          className="filter-rail-clear"
          onClick={onClear}
          disabled={loading || (isEmptyDraft && facetsEqual(applied, EMPTY_FACETS))}
        >
          Clear all
        </button>
      </div>

      {idLookup && (
        <p className="filter-rail-hint" role="note">
          Filters don&apos;t apply to ID lookups — the observation or program comes back as is.
        </p>
      )}

      <Section title="Instrument" summary={instrumentSummary}>
        <div className="filter-rail-toggles" role="group" aria-label="Instrument">
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst}
              type="button"
              className="filter-rail-toggle"
              data-instrument={inst.toLowerCase()}
              aria-pressed={value.instruments.includes(inst)}
              onClick={() => update({ instruments: toggleIn(value.instruments, inst) })}
            >
              <span className="filter-rail-swatch" aria-hidden="true" />
              {normalizeInstrument(inst)}
            </button>
          ))}
        </div>
        {value.instruments.length > 0 && (
          <div className="filter-rail-toggles filter-rail-modes" role="group" aria-label="Mode">
            <span className="filter-rail-label">Mode</span>
            {INSTRUMENT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="filter-rail-toggle filter-rail-toggle-mono"
                aria-pressed={value.modes.includes(mode)}
                onClick={() => update({ modes: toggleIn(value.modes, mode) })}
              >
                /{mode}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Filter"
        summary={value.filters.length ? `${value.filters.length} selected` : undefined}
      >
        {filterChoices.length > 0 && (
          <div className="filter-rail-toggles" role="group" aria-label="Filter">
            {filterChoices.map((name) => (
              <button
                key={name}
                type="button"
                className="filter-rail-toggle filter-rail-toggle-mono"
                aria-pressed={value.filters.includes(name)}
                onClick={() => update({ filters: toggleIn(value.filters, name) })}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="filter-rail-add">
          <input
            type="text"
            className="filter-rail-input filter-rail-input-mono"
            aria-label="Add a filter by name"
            placeholder="e.g. F470N"
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value);
              if (filterError) setFilterError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addFilter();
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-base btn-compact filter-rail-add-btn"
            onClick={addFilter}
            disabled={!filterText.trim()}
          >
            Add
          </button>
        </div>
        {filterError && (
          <p className="filter-rail-error" role="alert">
            {filterError}
          </p>
        )}
      </Section>

      <Section title="Calibration level" summary={`Level ${value.calibLevels.join(', ')}`}>
        <div className="filter-rail-checks" role="group" aria-label="Calibration level">
          {CALIB_LEVELS.map((level) => (
            <label key={level} className="filter-rail-check">
              <input
                type="checkbox"
                checked={value.calibLevels.includes(level)}
                onChange={() => toggleCalib(level)}
              />
              <span>
                Level {level}
                <span className="filter-rail-check-hint">
                  {level === 3 ? 'combined' : level === 2 ? 'calibrated' : 'raw'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section
        title="Data product"
        summary={value.dataproductTypes.length ? value.dataproductTypes.join(', ') : undefined}
      >
        <div className="filter-rail-toggles" role="group" aria-label="Data product">
          {DATAPRODUCT_TYPES.map((dpt) => (
            <button
              key={dpt}
              type="button"
              className="filter-rail-toggle"
              aria-pressed={value.dataproductTypes.includes(dpt)}
              onClick={() => update({ dataproductTypes: toggleIn(value.dataproductTypes, dpt) })}
            >
              {dpt}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Observation date"
        defaultOpen={Boolean(value.dateFrom || value.dateTo)}
        summary={
          value.dateFrom || value.dateTo
            ? `${value.dateFrom || '…'} – ${value.dateTo || '…'}`
            : undefined
        }
      >
        <div className="filter-rail-range">
          <label className="filter-rail-field">
            <span className="filter-rail-label">From</span>
            <input
              type="date"
              className="filter-rail-input filter-rail-input-mono"
              value={value.dateFrom}
              max={value.dateTo || undefined}
              onChange={(e) => update({ dateFrom: e.target.value })}
            />
          </label>
          <label className="filter-rail-field">
            <span className="filter-rail-label">To</span>
            <input
              type="date"
              className="filter-rail-input filter-rail-input-mono"
              value={value.dateTo}
              min={value.dateFrom || undefined}
              onChange={(e) => update({ dateTo: e.target.value })}
            />
          </label>
        </div>
      </Section>

      <Section
        title="Exposure time"
        defaultOpen={Boolean(value.expMin || value.expMax)}
        summary={
          value.expMin || value.expMax
            ? `${value.expMin || '0'} – ${value.expMax || '…'} s`
            : undefined
        }
      >
        <div className="filter-rail-range">
          <label className="filter-rail-field">
            <span className="filter-rail-label">Min (s)</span>
            <input
              type="number"
              className="filter-rail-input filter-rail-input-mono"
              min="0"
              step="any"
              value={value.expMin}
              onChange={(e) => update({ expMin: e.target.value })}
            />
          </label>
          <label className="filter-rail-field">
            <span className="filter-rail-label">Max (s)</span>
            <input
              type="number"
              className="filter-rail-input filter-rail-input-mono"
              min="0"
              step="any"
              value={value.expMax}
              onChange={(e) => update({ expMax: e.target.value })}
            />
          </label>
        </div>
      </Section>

      <Section title="Intent" defaultOpen={value.intent !== 'science'} summary={value.intent}>
        <div className="filter-rail-checks" role="radiogroup" aria-label="Intent">
          {(['science', 'calibration', 'any'] as Intent[]).map((intent) => (
            <label key={intent} className="filter-rail-check">
              <input
                type="radio"
                name="mast-intent"
                value={intent}
                checked={value.intent === intent}
                onChange={() => update({ intent })}
              />
              <span>
                {intent === 'any' ? 'Any' : intent === 'science' ? 'Science' : 'Calibration'}
              </span>
            </label>
          ))}
        </div>
      </Section>

      <div className="filter-rail-footer">
        <button
          type="button"
          className="btn-base btn-standard filter-rail-apply"
          onClick={onApply}
          disabled={loading || unchanged}
        >
          Apply filters
        </button>
        {unchanged && !isEmptyDraft && <span className="filter-rail-footer-note">Applied</span>}
      </div>
    </aside>
  );
};

export default FilterRail;
