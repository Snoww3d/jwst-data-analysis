/**
 * Start a calibration, data first — /calibrate/new (#1738).
 *
 * Inverts the old order. You choose the data you're holding, then the app
 * offers the recipes that can process it, then hands off to the existing
 * configuration page (stage timeline, curated parameters, estimate) as the
 * review step.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import {
  fitRecipes,
  formatBytes,
  groupByTarget,
  suffixOf,
} from '../components/calibration/dataGrouping';
import { listRecipes } from '../services/calibrationService';
import * as jwstDataService from '../services/jwstDataService';
import type { CalibrationRecipe } from '../types/CalibrationTypes';
import type { JwstDataModel } from '../types/JwstDataTypes';
import './CalibrateNew.css';

export default function CalibrateNew() {
  const navigate = useNavigate();
  const [items, setItems] = useState<JwstDataModel[] | null>(null);
  const [recipes, setRecipes] = useState<CalibrationRecipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([jwstDataService.getAll(false), listRecipes()])
      .then(([data, recipeList]) => {
        if (cancelled) return;
        setItems(data);
        setRecipes(recipeList);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load library');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const filtered = (items ?? []).filter((item) => {
      if (!query.trim()) return true;
      const haystack = `${item.fileName} ${item.metadata?.mast_target_name ?? ''}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
    return groupByTarget(filtered);
  }, [items, query]);

  const selected = useMemo(
    () => (items ?? []).filter((i) => selectedIds.includes(i.id)),
    [items, selectedIds]
  );
  const fits = useMemo(() => fitRecipes(recipes, selected), [recipes, selected]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleGroup = (ids: string[], allOn: boolean) =>
    setSelectedIds((prev) =>
      allOn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))
    );

  const chooseRecipe = (recipe: CalibrationRecipe) => {
    // Hand off to the existing config page as the review step, with the
    // chosen files pre-selected.
    navigate(`/calibrate/${recipe.id}`, {
      state: { inputDataIds: selected.map((i) => i.id) },
    });
  };

  if (error) {
    return (
      <div className="calibrate-new">
        <EmptyState title="Couldn't load your library" description={error} />
      </div>
    );
  }

  return (
    <div className="calibrate-new">
      <nav className="calibrate-run-breadcrumb">
        <Link to="/calibrate">← Runs</Link>
      </nav>

      <ol className="calibrate-steps" aria-label="Progress">
        <li className={step === 1 ? 'is-current' : 'is-done'}>1 · Choose data</li>
        <li className={step === 2 ? 'is-current' : ''}>2 · Choose recipe</li>
        <li>3 · Review &amp; run</li>
      </ol>

      {step === 1 && (
        <section aria-labelledby="data-heading">
          <div className="calibrate-new-head">
            <h1 id="data-heading">Which data are you calibrating?</h1>
            <input
              type="search"
              aria-label="Search library"
              placeholder="Search by file or target…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {items === null && <p role="status">Loading library…</p>}
          {items !== null && groups.length === 0 && (
            <EmptyState
              title="Nothing to calibrate yet"
              description="Import observations from MAST first — they'll show up here grouped by target."
            />
          )}

          {groups.map((group) => {
            const ids = group.items.map((i) => i.id);
            const allOn = ids.every((id) => selectedIds.includes(id));
            return (
              <div className="data-group" key={group.key}>
                <div className="data-group-head">
                  <label className="data-group-title">
                    <input
                      type="checkbox"
                      checked={allOn}
                      aria-label={`Select all in ${group.label}`}
                      onChange={() => toggleGroup(ids, allOn)}
                    />
                    <strong>{group.label}</strong>
                  </label>
                  <span className="data-group-meta">
                    {group.instruments.join(', ')} · {group.items.length} files ·{' '}
                    {formatBytes(group.totalBytes)}
                  </span>
                </div>
                {group.filters.length > 0 && (
                  <div className="data-chips">
                    {group.filters.map((f) => (
                      <span className="data-chip" key={f}>
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <ul className="data-files">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <span>{item.fileName}</span>
                        <span className="data-file-suffix">{suffixOf(item) ?? '—'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="calibrate-new-bar">
            <span>
              {selected.length === 0
                ? 'Nothing selected yet'
                : `${selected.length} file${selected.length === 1 ? '' : 's'} selected`}
            </span>
            <button
              type="button"
              className="btn-base btn-standard"
              disabled={selected.length === 0}
              onClick={() => setStep(2)}
            >
              Choose recipe →
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="recipe-heading">
          <div className="calibrate-new-head">
            <h1 id="recipe-heading">Which recipe?</h1>
            <button type="button" className="btn-base btn-compact" onClick={() => setStep(1)}>
              ← Change data
            </button>
          </div>
          <p className="calibrate-hint">
            {selected.length} file{selected.length === 1 ? '' : 's'} selected. Recipes for a
            different instrument are shown last and can&apos;t process this data.
          </p>
          <ul className="recipe-fit-list">
            {fits.map(({ recipe, applicable, reason }) => (
              <li key={recipe.id} className={applicable ? '' : 'recipe-fit-off'}>
                <div>
                  <strong>{recipe.name}</strong>
                  <div className="calibrate-hint">{reason ?? recipe.description}</div>
                </div>
                <button
                  type="button"
                  className="btn-base btn-compact"
                  disabled={!applicable}
                  onClick={() => chooseRecipe(recipe)}
                >
                  Review &amp; run →
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
