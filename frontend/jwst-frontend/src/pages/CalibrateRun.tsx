/**
 * Calibration run configuration — /calibrate/:recipeId.
 *
 * Stage toggles, per-step parameter editor (seeded from the recipe's own
 * overrides) and input selection. Starting a run navigates to
 * /calibrate/runs/:jobId (#1734): a run outlives this page, so its progress
 * belongs at a durable URL rather than in this component's state.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { StageTimeline } from '../components/calibration/StageTimeline';
import { ParamField } from '../components/calibration/ParamField';
import { specFor as paramSpecFor, type ParamSpec } from '../components/calibration/paramCatalog';
import {
  IMAGING_PIPELINE,
  blockedReason,
  estimateMinutes,
  formatEstimate,
} from '../components/calibration/stagePipeline';
import {
  CANONICAL_SUFFIX,
  SUFFIXES_FOR_LEVEL,
  isOrderedLevel,
  levelFromFileName,
  stagesBetween,
  type OrderedLevel,
} from '../components/calibration/processingLevels';
import { getRecipe, startRun } from '../services/calibrationService';
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

interface ReprocessState {
  /** Library item ids to pre-select (#1751 — not storage keys). */
  inputDataIds?: string[];
  stage3Only?: boolean;
  /** The level the chosen files are AT, and where they should end up (#1756).
   *  The stages follow from the pair, so the caller never names a stage. */
  startLevel?: OrderedLevel;
  targetLevel?: OrderedLevel;
  /** Settings carried back from a finished run (#1735). The engine stores a
   *  recipe snapshot per job with the run's stage toggles already applied, so
   *  a re-run can rebuild this form exactly as it was submitted. */
  rerun?: {
    enabledStages?: Record<string, boolean>;
    runOverrides?: StepOverrides;
    inputDataIds?: string[];
  };
}

function rowsFromOverrides(overrides: StepOverrides): ParamRow[] {
  const rows: ParamRow[] = [];
  for (const [step, params] of Object.entries(overrides)) {
    for (const [param, value] of Object.entries(params)) {
      rows.push({ step, param, value: JSON.stringify(value) });
    }
  }
  return rows;
}

/**
 * Remounts on every recipe change (param changes only — no in-app route can
 * reach /calibrate/X from /calibrate/X with different state). React Router reuses the component instance
 * across a param-only navigation, which would otherwise leave the previous
 * recipe's selection, library list and loaded flag in place — long enough to
 * submit recipe A's inputs against recipe B. A key is the whole fix; resetting
 * five pieces of state by hand is the version that rots.
 */
export default function CalibrateRun() {
  const { recipeId } = useParams<{ recipeId: string }>();
  return <CalibrateRunForm key={recipeId} />;
}

function CalibrateRunForm() {
  const { recipeId } = useParams<{ recipeId: string }>();
  // Library "Reprocess" pre-fills inputs and narrows to the stage-3 path.
  const reprocess = (useLocation().state ?? {}) as ReprocessState;
  const [recipe, setRecipe] = useState<CalibrationRecipe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>({});
  const [paramRows, setParamRows] = useState<ParamRow[]>([]);
  const [libraryFiles, setLibraryFiles] = useState<{ id: string; fileName: string }[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  // Tracked as "resolved" rather than "loading" so the effect never calls a
  // setter synchronously (cascading-render lint rule); loading is derived.
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!recipeId) return undefined;
    let cancelled = false;
    getRecipe(recipeId)
      .then((loaded) => {
        if (cancelled) return;
        setRecipe(loaded);
        const rerun = reprocess.rerun;
        // Stages needed to get from where the files ARE to where they should
        // end up — so "process this raw file to L3" enables all three without
        // the caller naming any of them.
        const byLevel =
          reprocess.startLevel && reprocess.targetLevel
            ? stagesBetween(reprocess.startLevel, reprocess.targetLevel)
            : null;
        setEnabledStages(
          Object.fromEntries(
            loaded.stages.map((s) => [
              s.name,
              // Precedence: a re-run's own toggles, then a level target, then
              // the Reprocess stage-3 fast path, then the recipe's defaults.
              rerun?.enabledStages
                ? (rerun.enabledStages[s.name] ?? false)
                : byLevel
                  ? byLevel.includes(s.name)
                  : reprocess.stage3Only
                    ? s.name === 'image3'
                    : s.enabled,
            ])
          )
        );
        setParamRows(
          rerun?.runOverrides ? rowsFromOverrides(rerun.runOverrides) : rowsFromRecipe(loaded)
        );
        const presetInputs = rerun?.inputDataIds ?? reprocess.inputDataIds;
        if (presetInputs?.length) setSelectedInputs(presetInputs);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load recipe');
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const reprocessInputs = reprocess.rerun?.inputDataIds ?? reprocess.inputDataIds;
  const needsLibraryInputs =
    recipe?.input_source.type === 'library_products' || Boolean(reprocessInputs?.length);
  // Which suffixes to OFFER for browsing. Reprocess supplies calibrated files
  // regardless of the recipe's own input suffix (seed recipes are _uncal MAST
  // queries), so that path browses _cal instead.
  //
  // This filter never decides what the user may RUN on: pre-selected items are
  // always listed (below), whatever their suffix. Making the filter alone the
  // gate is what broke both directions in turn — first _uncal picks vanished
  // on a reprocess, then _cal picks vanished on a seed recipe. A suffix the
  // pipeline can't start from is a stage-blocking concern, and StageTimeline
  // already explains it; it is not a reason to hide the user's own file.
  const stage3Only = Boolean(reprocess.stage3Only);
  // Validated: location.state survives reload and back/forward, so a stale or
  // hand-edited entry must not index SUFFIXES_FOR_LEVEL with a missing key.
  const startLevel = isOrderedLevel(reprocess.startLevel) ? reprocess.startLevel : undefined;
  const inputSuffixes = useMemo(() => {
    // Browse the products that ARE the chosen level, so the list matches what
    // the user just clicked rather than the recipe's own starting point.
    if (startLevel) return SUFFIXES_FOR_LEVEL[startLevel];
    if (stage3Only) return ['_cal'];
    return recipe?.input_source.product_suffixes ?? ['_cal'];
  }, [startLevel, stage3Only, recipe]);

  useEffect(() => {
    // Wait for the recipe: until it loads, inputSuffixes falls back to ['_cal'],
    // so fetching now would briefly list the wrong products (and fetch twice).
    if (!needsLibraryInputs || !recipe) return undefined;
    let cancelled = false;
    jwstDataService
      .getAll(false)
      .then((items) => {
        if (cancelled) return;
        setLibraryError(null);
        // Match on fileName: the DTO has no filePath (#1751), and the
        // product suffix is part of the name anyway.
        const preset = new Set(reprocessInputs ?? []);
        // Classify by level rather than substring: a filename containing
        // "_cal" may well be an L3 mosaic (product names may contain "_"), and
        // listing it here would let it be submitted as a calibration input.
        const shown = items.filter(
          (item) =>
            preset.has(item.id) ||
            (startLevel
              ? levelFromFileName(item.fileName) === startLevel
              : inputSuffixes.some((s) => (item.fileName ?? '').endsWith(`${s}.fits`)))
        );
        // Pre-selected items first: they are why the user is on this page.
        shown.sort((a, b) => Number(preset.has(b.id)) - Number(preset.has(a.id)));
        setLibraryFiles(shown.map((item) => ({ id: item.id, fileName: item.fileName })));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Distinguish a failed fetch from "your library has nothing matching" —
        // the empty state used to claim the latter for both.
        setLibraryFiles([]);
        setLibraryError(err instanceof Error ? err.message : 'Failed to load your library');
      })
      .finally(() => {
        if (!cancelled) setLibraryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsLibraryInputs, recipe, reprocessInputs, inputSuffixes, startLevel]);

  const libraryLoading = needsLibraryInputs && !libraryLoaded;

  // What actually gets submitted: only files the page is showing, so a run can
  // never use a selection the user cannot see or uncheck. Since pre-selected
  // items are always listed, anything missing here is missing from the library
  // itself — archived, deleted, or not visible to this user.
  const visibleSelected = useMemo(
    () => selectedInputs.filter((id) => libraryFiles.some((f) => f.id === id)),
    [selectedInputs, libraryFiles]
  );
  const hiddenSelectedCount = selectedInputs.length - visibleSelected.length;

  // Suffixes actually in play: the selected library files if there are any,
  // otherwise what the recipe's own input source will fetch.
  const activeSuffixes = useMemo(() => {
    const names = libraryFiles
      .filter((f) => visibleSelected.includes(f.id))
      .map((f) => f.fileName ?? '');
    if (names.length > 0) {
      // Via the level, so `_crf` is known to be calibrated rather than falling
      // through to "assume raw" — which told the timeline that Detector1 could
      // run on already-calibrated data, the failure #1736 exists to prevent.
      return Array.from(
        new Set(
          names.map((n) => {
            const level = levelFromFileName(n);
            return level ? CANONICAL_SUFFIX[level] : '_uncal';
          })
        )
      );
    }
    return recipe?.input_source.product_suffixes ?? [];
  }, [visibleSelected, libraryFiles, recipe]);

  const enabledSpecs = useMemo(
    () =>
      IMAGING_PIPELINE.filter((s) => enabledStages[s.name] && !blockedReason(s, activeSuffixes)),
    [enabledStages, activeSuffixes]
  );
  // Split rows into ones the catalog can render properly and everything else.
  // Index is kept so edits still address the single paramRows array.
  const { curatedRows, advancedRows } = useMemo(() => {
    const curated: { row: ParamRow; index: number; spec: ParamSpec }[] = [];
    const advanced: { row: ParamRow; index: number }[] = [];
    paramRows.forEach((row, index) => {
      const spec = paramSpecFor(row.step, row.param);
      if (spec) curated.push({ row, index, spec });
      else advanced.push({ row, index });
    });
    return { curatedRows: curated, advancedRows: advanced };
  }, [paramRows]);

  const fileCount = visibleSelected.length;
  // Only when the run will actually download: the executor skips the MAST
  // fetch entirely once library inputs are supplied, so warning about it on a
  // library run describes something that will not happen.
  const fromMast = recipe?.input_source.type === 'mast_query' && !needsLibraryInputs;
  const usesDetector1 = enabledSpecs.some((s) => s.name === 'detector1');

  // Blocked stages are rendered off and excluded from the estimate, so they
  // must not be submitted as on — the engine would honour the toggle and fail
  // hours in, which is the failure #1736 exists to prevent.
  const effectiveStages = useMemo(
    () =>
      Object.fromEntries(
        IMAGING_PIPELINE.map((s) => [
          s.name,
          Boolean(enabledStages[s.name]) && !blockedReason(s, activeSuffixes),
        ])
      ),
    [enabledStages, activeSuffixes]
  );

  // Say why, on the control itself — a disabled button with no reason is the
  // dead end this redesign keeps running into.
  const runBlockedReason = useMemo(() => {
    if (!recipe || starting) return null;
    // Loading already says so where the list will appear; repeating it here
    // would just duplicate the same sentence on the page.
    if (libraryLoading) return null;
    // Order matters: "choose a file" is only actionable when there ARE files.
    // Saying it over an empty or failed list is the dead end this hint exists
    // to remove, not an instance of it.
    if (needsLibraryInputs && libraryError)
      return "Your library couldn't be loaded, so there's nothing to run on yet.";
    if (needsLibraryInputs && libraryFiles.length === 0)
      return `No library files match this recipe (looking for ${inputSuffixes.join(', ')}). Import or calibrate some data first.`;
    if (needsLibraryInputs && visibleSelected.length === 0)
      return 'Choose at least one input file above.';
    if (enabledSpecs.length === 0)
      return 'No stage can run: every stage is either turned off or blocked by the inputs you chose.';
    return null;
  }, [
    recipe,
    starting,
    needsLibraryInputs,
    libraryLoading,
    libraryError,
    libraryFiles,
    inputSuffixes,
    visibleSelected,
    enabledSpecs,
  ]);

  const runDisabled = useMemo(() => {
    if (!recipe || starting) return true;
    if (libraryLoading) return true;
    if (needsLibraryInputs && visibleSelected.length === 0) return true;
    return enabledSpecs.length === 0;
  }, [recipe, starting, needsLibraryInputs, libraryLoading, visibleSelected, enabledSpecs]);

  const handleRun = async () => {
    if (!recipe) return;
    setStartError(null);
    setStarting(true);
    try {
      const response = await startRun({
        recipeId: recipe.id,
        inputDataIds: needsLibraryInputs ? visibleSelected : [],
        runOverrides: overridesFromRows(paramRows),
        enabledStages: effectiveStages,
      });
      // Hand off to the run's own URL — it survives refresh and stays
      // reachable from the history once we navigate away.
      navigate(`/calibrate/runs/${response.jobId}`);
    } catch (err: unknown) {
      setStarting(false);
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

      <section className="calibrate-section" aria-labelledby="stages-heading">
        <h2 id="stages-heading">Stages</h2>
        <StageTimeline
          mode="config"
          enabled={enabledStages}
          inputSuffixes={activeSuffixes}
          onToggle={(name, next) => setEnabledStages((prev) => ({ ...prev, [name]: next }))}
        />
        <div className="stage-estimate">
          <span>
            Estimated <strong>{formatEstimate(estimateMinutes(enabledSpecs, fileCount))}</strong>
          </span>
          {fromMast && (
            <span className="stage-warning">· downloads raw data from MAST before it starts</span>
          )}
          {usesDetector1 && (
            <span className="stage-warning">
              · first run also downloads CRDS reference files (GBs)
            </span>
          )}
        </div>
      </section>

      <section className="calibrate-section" aria-labelledby="params-heading">
        <h2 id="params-heading">Parameters</h2>
        {curatedRows.length === 0 && (
          <p className="calibrate-hint">
            This recipe runs on pipeline defaults. Add an override below if you need one.
          </p>
        )}

        {curatedRows.map(({ row, index, spec }) => (
          <ParamField
            key={`${row.step}-${row.param}-${index}`}
            spec={spec}
            value={row.value}
            onChange={(next) =>
              setParamRows((rows) => rows.map((r, i) => (i === index ? { ...r, value: next } : r)))
            }
            onRemove={() => setParamRows((rows) => rows.filter((_, i) => i !== index))}
          />
        ))}

        {/* Everything the catalog doesn't know keeps the original raw editor —
            the plan's "advanced free-form section", not a replacement. */}
        <details className="param-advanced" open={advancedRows.length > 0}>
          <summary>Advanced — raw step parameters ({advancedRows.length})</summary>
          <p className="calibrate-hint">
            Any jwst step parameter. Numbers/booleans are auto-detected — wrap a value in quotes
            (&quot;010&quot;) to force a string; lists use JSON ([1.0, 2.0]).
          </p>
          {advancedRows.map(({ row, index }) => (
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
        </details>
      </section>

      <section className="calibrate-section" aria-labelledby="inputs-heading">
        <h2 id="inputs-heading">Inputs</h2>
        {needsLibraryInputs ? (
          libraryLoading ? (
            <p className="calibrate-hint">Loading your library…</p>
          ) : libraryError ? (
            <p className="calibrate-error" role="alert">
              Couldn&apos;t load your library: {libraryError}
            </p>
          ) : libraryFiles.length === 0 ? (
            <p className="calibrate-hint">
              No matching library files found (looking for {inputSuffixes.join(', ')}).
            </p>
          ) : (
            <ul className="calibrate-input-list">
              {libraryFiles.map((file) => (
                <li key={file.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedInputs.includes(file.id)}
                      onChange={(event) =>
                        setSelectedInputs((prev) =>
                          event.target.checked
                            ? [...prev, file.id]
                            : prev.filter((f) => f !== file.id)
                        )
                      }
                    />
                    <span className="calibrate-input-file">{file.fileName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {/* Requires a non-empty list: with nothing shown, "the files checked
            above" describes UI that isn't on the screen — the empty state and
            the run hint already cover that case. */}
        {needsLibraryInputs &&
          !libraryError &&
          !libraryLoading &&
          libraryFiles.length > 0 &&
          hiddenSelectedCount > 0 && (
            <p className="calibrate-hint" role="status">
              {hiddenSelectedCount} pre-selected {hiddenSelectedCount === 1 ? 'file' : 'files'}{' '}
              {hiddenSelectedCount === 1 ? "isn't" : "aren't"} in your library any more (archived,
              deleted, or no longer shared with you). Only the files checked above will be used.
            </p>
          )}
        {!needsLibraryInputs && (
          <p className="calibrate-hint">
            Data is fetched from MAST (proposal{' '}
            {recipe.input_source.type === 'mast_query' ? recipe.input_source.proposal_id : ''}) when
            the run starts.
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
        aria-describedby={runBlockedReason ? 'run-blocked-reason' : undefined}
        onClick={() => void handleRun()}
      >
        {starting ? 'Starting…' : 'Run calibration'}
      </button>
      {runBlockedReason && (
        <p id="run-blocked-reason" className="calibrate-hint" role="status">
          {runBlockedReason}
        </p>
      )}
    </div>
  );
}
