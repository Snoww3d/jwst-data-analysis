/**
 * Calibration run configuration + live progress (#1709 PR 8).
 *
 * /calibrate/:recipeId — stage toggles, per-step parameter editor (seeded
 * from the recipe's own overrides), input selection (recipe MAST query or
 * library _cal files), then a live progress view: per-stage checklist,
 * download %, log tail, cancel.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogPanel } from '../components/wizard/LogPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { useCalibrationJob } from '../hooks/useCalibrationJob';
import { cancelJob, getRecipe, startRun } from '../services/calibrationService';
import * as jwstDataService from '../services/jwstDataService';
import type { CalibrationRecipe, ScalarOverride, StepOverrides } from '../types/CalibrationTypes';
import './CalibrateRun.css';

interface ParamRow {
  step: string;
  param: string;
  value: string;
}

function rowsFromRecipe(recipe: CalibrationRecipe): ParamRow[] {
  const rows: ParamRow[] = [];
  for (const stage of recipe.stages) {
    for (const [step, params] of Object.entries(stage.step_overrides)) {
      for (const [param, value] of Object.entries(params)) {
        rows.push({ step, param, value: JSON.stringify(value) });
      }
    }
  }
  return rows;
}

function parseValue(raw: string): ScalarOverride | ScalarOverride[] {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '') return null;
  if (trimmed.startsWith('[')) {
    // List-valued params round-trip as JSON (e.g. [1.0, 2.0]).
    try {
      return JSON.parse(trimmed) as ScalarOverride[];
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith('"')) {
    // Quoted = force string ("010" stays "010", never the number 10).
    return trimmed.replace(/^"(.*)"$/, '$1');
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) return numeric;
  return trimmed;
}

function overridesFromRows(rows: ParamRow[]): StepOverrides {
  const overrides: StepOverrides = {};
  for (const row of rows) {
    if (!row.step.trim() || !row.param.trim()) continue;
    overrides[row.step.trim()] ??= {};
    overrides[row.step.trim()][row.param.trim()] = parseValue(row.value);
  }
  return overrides;
}

export default function CalibrateRun() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const [recipe, setRecipe] = useState<CalibrationRecipe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>({});
  const [paramRows, setParamRows] = useState<ParamRow[]>([]);
  const [libraryFiles, setLibraryFiles] = useState<string[]>([]);
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { job, isTerminal, error: pollError } = useCalibrationJob(jobId);

  useEffect(() => {
    if (!recipeId) return undefined;
    let cancelled = false;
    getRecipe(recipeId)
      .then((loaded) => {
        if (cancelled) return;
        setRecipe(loaded);
        setEnabledStages(Object.fromEntries(loaded.stages.map((s) => [s.name, s.enabled])));
        setParamRows(rowsFromRecipe(loaded));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load recipe');
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const needsLibraryInputs = recipe?.input_source.type === 'library_products';

  useEffect(() => {
    if (!needsLibraryInputs) return undefined;
    let cancelled = false;
    jwstDataService
      .getAll(false)
      .then((items) => {
        if (cancelled) return;
        const suffixes = recipe?.input_source.product_suffixes ?? ['_cal'];
        const files = items
          .map((item) => item.filePath)
          .filter((path): path is string =>
            Boolean(path && suffixes.some((s) => path.includes(s)))
          );
        setLibraryFiles(files);
      })
      .catch(() => {
        if (!cancelled) setLibraryFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsLibraryInputs, recipe]);

  const runDisabled = useMemo(() => {
    if (!recipe || jobId) return true;
    if (needsLibraryInputs && selectedInputs.length === 0) return true;
    return !Object.values(enabledStages).some(Boolean);
  }, [recipe, jobId, needsLibraryInputs, selectedInputs, enabledStages]);

  const handleRun = async () => {
    if (!recipe) return;
    setStartError(null);
    try {
      const response = await startRun({
        recipeId: recipe.id,
        inputs: needsLibraryInputs ? selectedInputs : [],
        runOverrides: overridesFromRows(paramRows),
        enabledStages,
      });
      setJobId(response.jobId);
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : 'Failed to start run');
    }
  };

  if (loadError) {
    return (
      <div className="calibrate-run">
        <EmptyState title="Couldn't load recipe" description={loadError} />
      </div>
    );
  }
  if (!recipe) {
    return (
      <div className="calibrate-run">
        <p role="status">Loading recipe…</p>
      </div>
    );
  }

  return (
    <div className="calibrate-run">
      <nav className="calibrate-run-breadcrumb">
        <Link to="/calibrate">← All recipes</Link>
      </nav>
      <h1>{recipe.name}</h1>
      <p className="calibrate-run-description">{recipe.description}</p>

      {!jobId && (
        <>
          <section className="calibrate-section" aria-labelledby="stages-heading">
            <h2 id="stages-heading">Stages</h2>
            <div className="calibrate-stage-toggles">
              {recipe.stages.map((stage) => (
                <label key={stage.name} className="calibrate-stage-toggle">
                  <input
                    type="checkbox"
                    checked={enabledStages[stage.name] ?? false}
                    onChange={(event) =>
                      setEnabledStages((prev) => ({
                        ...prev,
                        [stage.name]: event.target.checked,
                      }))
                    }
                  />
                  <span>{stage.name}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="calibrate-section" aria-labelledby="params-heading">
            <h2 id="params-heading">Parameters</h2>
            <p className="calibrate-hint">
              Values are jwst step parameters; run values override the recipe. Numbers/booleans are
              auto-detected — wrap a value in quotes (&quot;010&quot;) to force a string; lists use
              JSON ([1.0, 2.0]).
            </p>
            {paramRows.map((row, index) => (
              <div className="calibrate-param-row" key={`${row.step}-${row.param}-${index}`}>
                <input
                  aria-label={`Step for parameter ${index + 1}`}
                  value={row.step}
                  onChange={(e) =>
                    setParamRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, step: e.target.value } : r))
                    )
                  }
                />
                <input
                  aria-label={`Name for parameter ${index + 1}`}
                  value={row.param}
                  onChange={(e) =>
                    setParamRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, param: e.target.value } : r))
                    )
                  }
                />
                <input
                  aria-label={`Value for parameter ${index + 1}`}
                  value={row.value}
                  onChange={(e) =>
                    setParamRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r))
                    )
                  }
                />
                <button
                  type="button"
                  className="btn-base btn-compact"
                  onClick={() => setParamRows((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-base btn-compact"
              onClick={() => setParamRows((rows) => [...rows, { step: '', param: '', value: '' }])}
            >
              Add parameter
            </button>
          </section>

          <section className="calibrate-section" aria-labelledby="inputs-heading">
            <h2 id="inputs-heading">Inputs</h2>
            {needsLibraryInputs ? (
              libraryFiles.length === 0 ? (
                <p className="calibrate-hint">
                  No matching library files found (looking for{' '}
                  {recipe.input_source.product_suffixes.join(', ')}).
                </p>
              ) : (
                <ul className="calibrate-input-list">
                  {libraryFiles.map((file) => (
                    <li key={file}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedInputs.includes(file)}
                          onChange={(event) =>
                            setSelectedInputs((prev) =>
                              event.target.checked
                                ? [...prev, file]
                                : prev.filter((f) => f !== file)
                            )
                          }
                        />
                        <span className="calibrate-input-file">{file}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="calibrate-hint">
                Data is fetched from MAST (proposal{' '}
                {recipe.input_source.type === 'mast_query' ? recipe.input_source.proposal_id : ''})
                when the run starts.
              </p>
            )}
          </section>

          {startError && (
            <p className="calibrate-error" role="alert">
              {startError}
            </p>
          )}
          <button
            type="button"
            className="btn-base btn-standard calibrate-run-button"
            disabled={runDisabled}
            onClick={() => void handleRun()}
          >
            Run calibration
          </button>
        </>
      )}

      {jobId && (
        <section className="calibrate-section" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Run progress</h2>
          {pollError && (
            <p className="calibrate-hint" role="alert">
              {pollError} (retrying…)
            </p>
          )}
          {job && (
            <>
              <p className="calibrate-status" role="status">
                Status: <strong>{job.status}</strong>
                {job.progress.message ? ` — ${job.progress.message}` : ''}
                {job.status === 'downloading' && job.progress.downloadPct !== null
                  ? ` (${job.progress.downloadPct}%)`
                  : ''}
              </p>
              {job.progress.stages.length > 0 && (
                <ul className="calibrate-stage-checklist">
                  {job.progress.stages.map((stage) => (
                    <li key={stage.name} data-status={stage.status}>
                      <span className="calibrate-stage-status">
                        {stage.status === 'done' ? '✓' : stage.status === 'running' ? '…' : '○'}
                      </span>
                      {stage.name}
                    </li>
                  ))}
                </ul>
              )}
              <LogPanel messages={job.logTail} defaultOpen={true} />
              {!isTerminal && (
                <button
                  type="button"
                  className="btn-base btn-compact"
                  onClick={() => {
                    setCancelling(true);
                    cancelJob(job.jobId).catch(() => setCancelling(false));
                  }}
                  disabled={cancelling || job.cancelRequested}
                >
                  {cancelling || job.cancelRequested ? 'Cancelling…' : 'Cancel run'}
                </button>
              )}
              {job.status === 'succeeded' && job.result && (
                <div className="calibrate-result" role="status">
                  <h3>Outputs</h3>
                  <ul>
                    {job.result.outputs.map((output) => (
                      <li key={output.storageKey}>
                        <code>{output.storageKey}</code> (
                        {(output.sizeBytes / 1024 / 1024).toFixed(1)} MB)
                      </li>
                    ))}
                  </ul>
                  {job.result.jwstVersion && (
                    <p className="calibrate-hint">
                      jwst {job.result.jwstVersion}
                      {job.result.crdsContext ? ` · CRDS ${job.result.crdsContext}` : ''}
                    </p>
                  )}
                </div>
              )}
              {job.status === 'failed' && (
                <p className="calibrate-error" role="alert">
                  Run failed: {job.error ?? 'unknown error'}
                </p>
              )}
              {job.status === 'cancelled' && (
                <p className="calibrate-hint" role="status">
                  Run cancelled.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
