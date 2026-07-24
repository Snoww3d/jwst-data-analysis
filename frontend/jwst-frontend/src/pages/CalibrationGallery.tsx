/**
 * Calibration recipe gallery (#1709 PR 7): browse curated + own recipes.
 * The run-configuration flow (/calibrate/:recipeId) lands in PR 8.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { getCapabilities, importNotebook, listRecipes } from '../services/calibrationService';
import type { CalibrationCapabilities, CalibrationRecipe } from '../types/CalibrationTypes';
import './CalibrationGallery.css';

const INSTRUMENT_LABELS: Record<CalibrationRecipe['instrument'], string> = {
  nircam: 'NIRCam',
  niriss: 'NIRISS',
  miri: 'MIRI',
};

function overrideCount(recipe: CalibrationRecipe): number {
  return recipe.stages.reduce(
    (total, stage) =>
      total +
      Object.values(stage.step_overrides).reduce((n, params) => n + Object.keys(params).length, 0),
    0
  );
}

export function CalibrationRecipeCard({ recipe }: { recipe: CalibrationRecipe }) {
  const enabledStages = recipe.stages.filter((stage) => stage.enabled);
  const inputLabel =
    recipe.input_source.type === 'mast_query'
      ? `MAST PID ${recipe.input_source.proposal_id}`
      : 'Library files';
  const overrides = overrideCount(recipe);

  return (
    <article className="calibration-card" data-testid="calibration-recipe-card">
      <header className="calibration-card-header">
        <span className={`calibration-instrument calibration-instrument-${recipe.instrument}`}>
          {INSTRUMENT_LABELS[recipe.instrument]}
        </span>
        {recipe.source === 'seed' && <span className="calibration-badge">Curated</span>}
      </header>
      <h2 className="calibration-card-title">{recipe.name}</h2>
      <p className="calibration-card-description">{recipe.description}</p>
      <div className="calibration-card-stages" aria-label="Pipeline stages">
        {enabledStages.map((stage) => (
          <span key={stage.name} className="calibration-stage-chip">
            {stage.name}
          </span>
        ))}
      </div>
      <Link className="btn-base btn-compact calibration-card-cta" to={`/calibrate/${recipe.id}`}>
        Configure &amp; run
      </Link>
      <footer className="calibration-card-meta">
        <span>{inputLabel}</span>
        <span>
          {overrides === 0
            ? 'Pipeline defaults'
            : `${overrides} tuned parameter${overrides === 1 ? '' : 's'}`}
        </span>
        {recipe.provenance.notebook_name && (
          <span title={`Derived from ${recipe.provenance.notebook_name}`}>STScI notebook</span>
        )}
      </footer>
    </article>
  );
}

export default function CalibrationGallery() {
  const [recipes, setRecipes] = useState<CalibrationRecipe[] | null>(null);
  const [capabilities, setCapabilities] = useState<CalibrationCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = async (file: File) => {
    setImportError(null);
    setImportWarnings([]);
    if (file.size > 5 * 1024 * 1024) {
      setImportError('Notebook exceeds the 5MB import limit.');
      return;
    }
    try {
      const text = await file.text();
      const result = await importNotebook(file.name, text);
      setImportWarnings(result.warnings);
      setRecipes((prev) => (prev ? [result.recipe, ...prev] : [result.recipe]));
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([listRecipes(), getCapabilities()])
      .then(([recipeList, caps]) => {
        if (cancelled) return;
        setRecipes(recipeList);
        setCapabilities(caps);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load recipes');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="calibration-gallery">
        <EmptyState title="Couldn't load calibration recipes" description={error} />
      </div>
    );
  }

  return (
    <div className="calibration-gallery">
      <header className="calibration-gallery-header">
        <h1>Calibration Recipes</h1>
        <p className="calibration-gallery-subtitle">
          Run the official JWST calibration pipeline with curated, editable settings — from quick
          Stage&nbsp;3 re-mosaics of library data to full raw-data reductions.
          {capabilities?.jwstVersion && (
            <span className="calibration-version"> Pipeline v{capabilities.jwstVersion}</span>
          )}
        </p>
        <div className="calibration-import">
          <input
            ref={fileInputRef}
            type="file"
            accept=".ipynb"
            className="calibration-import-input"
            aria-label="Import a JWPipeNB notebook"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportFile(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-base btn-compact"
            onClick={() => fileInputRef.current?.click()}
          >
            Import notebook…
          </button>
          <span className="calibrate-hint calibration-import-hint">
            STScI JWPipeNB imaging notebooks are parsed into recipes — code is never executed.
          </span>
        </div>
        {importError && (
          <p className="calibration-import-error" role="alert">
            {importError}
          </p>
        )}
        {importWarnings.length > 0 && (
          <ul className="calibration-import-warnings" role="status">
            {importWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {capabilities && !capabilities.calibrationEnabled && (
          <div className="calibration-disabled-banner" role="status">
            Calibration runs are disabled on this deployment — recipes are browsable, but the run
            flow is unavailable.
          </div>
        )}
      </header>
      {recipes === null ? (
        <p className="calibration-loading" role="status">
          Loading recipes…
        </p>
      ) : recipes.length === 0 ? (
        <EmptyState
          title="No recipes yet"
          description="Curated recipes are seeded at engine startup; user recipes appear here once created."
        />
      ) : (
        <div className="calibration-card-grid">
          {recipes.map((recipe) => (
            <CalibrationRecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
