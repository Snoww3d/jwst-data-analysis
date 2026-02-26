import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { WizardStepper } from '../components/wizard/WizardStepper';
import { DownloadStep } from '../components/guided/DownloadStep';
import { ProcessStep } from '../components/guided/ProcessStep';
import { ResultStep } from '../components/guided/ResultStep';
import { searchByTarget, startImport } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import { exportNChannelCompositeAsync, getCompositeToken } from '../services/compositeService';
import { subscribeToJobProgress } from '../hooks/useJobProgress';
import { API_BASE_URL } from '../config/api';
import type { ImportJobStatus, MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe, ObservationInput } from '../types/DiscoveryTypes';
import type { NChannelConfigPayload, OverallAdjustments } from '../types/CompositeTypes';
import { DEFAULT_CHANNEL_PARAMS, DEFAULT_OVERALL_ADJUSTMENTS } from '../types/CompositeTypes';
import './GuidedCreate.css';

type FlowStep = 1 | 2 | 3;

const WIZARD_STEPS = [
  { number: 1, label: 'Download' },
  { number: 2, label: 'Process' },
  { number: 3, label: 'Result' },
];

/**
 * Convert a hex color string (#rrggbb) to a hue value (0-360).
 */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

/**
 * Build NChannelConfigPayload array from recipe + imported data mappings.
 */
function buildChannelPayloads(
  recipe: CompositeRecipe,
  filterDataMap: Map<string, string[]>
): NChannelConfigPayload[] {
  const payloads: NChannelConfigPayload[] = [];
  for (const filter of recipe.filters) {
    const dataIds = filterDataMap.get(filter.toUpperCase()) ?? [];
    if (dataIds.length === 0) continue;
    const hexColor = recipe.colorMapping[filter] ?? '#ffffff';
    payloads.push({
      dataIds,
      color: { hue: hexToHue(hexColor) },
      label: filter,
      stretch: DEFAULT_CHANNEL_PARAMS.stretch,
      blackPoint: DEFAULT_CHANNEL_PARAMS.blackPoint,
      whitePoint: DEFAULT_CHANNEL_PARAMS.whitePoint,
      gamma: DEFAULT_CHANNEL_PARAMS.gamma,
      asinhA: DEFAULT_CHANNEL_PARAMS.asinhA,
      curve: DEFAULT_CHANNEL_PARAMS.curve,
      weight: DEFAULT_CHANNEL_PARAMS.weight,
    });
  }
  return payloads;
}

/**
 * Convert MAST observations into ObservationInputs for recipe engine.
 */
function toObservationInputs(observations: MastObservationResult[]): ObservationInput[] {
  const inputs: ObservationInput[] = [];
  for (const obs of observations) {
    if (!obs.filters || !obs.instrument_name) continue;
    inputs.push({
      filter: obs.filters,
      instrument: obs.instrument_name,
      observationId: obs.obs_id,
    });
  }
  return inputs;
}

/**
 * Deduplicate observations by filter — keep one per unique filter name.
 */
function deduplicateByFilter(observations: MastObservationResult[]): MastObservationResult[] {
  const seen = new Map<string, MastObservationResult>();
  for (const obs of observations) {
    const key = obs.filters?.toUpperCase();
    if (key && !seen.has(key)) {
      seen.set(key, obs);
    }
  }
  return Array.from(seen.values());
}

/**
 * Guided creation flow — download, process, and view composite result.
 *
 * Orchestrates the full pipeline:
 * 1. Resolve target + recipe from URL params
 * 2. Import MAST observations (download step)
 * 3. Generate composite via job queue (process step)
 * 4. Display result with adjustments + export (result step)
 */
export function GuidedCreate() {
  const [searchParams] = useSearchParams();
  const target = searchParams.get('target') ?? '';
  const recipeName = searchParams.get('recipe') ?? '';

  // Flow state
  const [currentStep, setCurrentStep] = useState<FlowStep>(1);
  const [recipe, setRecipe] = useState<CompositeRecipe | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Download state
  const [downloadProgress, setDownloadProgress] = useState<ImportJobStatus | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadComplete, setDownloadComplete] = useState(false);

  // Process state
  const [processPhase, setProcessPhase] = useState<'mosaic' | 'composite'>('composite');
  const [processProgress, setProcessProgress] = useState<ImportJobStatus | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processComplete, setProcessComplete] = useState(false);

  // Result state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compositeBlob, setCompositeBlob] = useState<Blob | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Refs for cleanup
  const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const filterDataMapRef = useRef<Map<string, string[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Cleanup on unmount — capture ref handles created during lifecycle
  useEffect(() => {
    const subsRef = subscriptionsRef;
    const abRef = abortRef;
    const prevRef = previewUrlRef;
    return () => {
      subsRef.current.forEach((s) => s.unsubscribe());
      abRef.current?.abort();
      if (prevRef.current) {
        URL.revokeObjectURL(prevRef.current);
      }
    };
  }, []);

  // Step 0: Resolve recipe from target name
  useEffect(() => {
    if (!target || !recipeName) {
      setInitError('Missing target or recipe parameters.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    async function resolveRecipe() {
      try {
        // Search MAST for observations
        const searchResult = await searchByTarget({ targetName: target }, controller.signal);
        if (controller.signal.aborted) return;

        const observations = searchResult.results ?? [];
        if (observations.length === 0) {
          setInitError('No observations found for this target.');
          return;
        }

        // Get recipe suggestions
        const inputs = toObservationInputs(observations);
        const recipeResponse = await suggestRecipes(
          { targetName: target, observations: inputs },
          controller.signal
        );
        if (controller.signal.aborted) return;

        // Find the matching recipe by name
        const matched = recipeResponse.recipes.find((r) => r.name === recipeName);
        if (!matched) {
          setInitError(`Recipe "${recipeName}" not found for this target.`);
          return;
        }

        setRecipe(matched);

        // Start downloads for each unique filter observation
        const recipeFilterSet = new Set(matched.filters.map((f) => f.toUpperCase()));
        const relevantObs = deduplicateByFilter(
          observations.filter((o) => o.filters && recipeFilterSet.has(o.filters.toUpperCase()))
        );

        if (relevantObs.length === 0) {
          setInitError('No matching observations found for this recipe.');
          return;
        }

        startDownloads(relevantObs, matched);
      } catch (err) {
        if (controller.signal.aborted) return;
        setInitError(err instanceof Error ? err.message : 'Failed to resolve recipe.');
      }
    }

    resolveRecipe();
    return () => controller.abort();
  }, [target, recipeName]);

  /**
   * Start importing MAST observations sequentially.
   * Tracks filter -> dataId mapping as each completes.
   */
  function startDownloads(observations: MastObservationResult[], matchedRecipe: CompositeRecipe) {
    let completedCount = 0;
    const totalObs = observations.length;

    async function importNext(index: number) {
      if (index >= observations.length) {
        // All downloads complete
        setDownloadComplete(true);
        startProcessing(matchedRecipe);
        return;
      }

      const obs = observations[index];
      const obsId = obs.obs_id;
      if (!obsId) {
        importNext(index + 1);
        return;
      }

      try {
        const jobResponse = await startImport({ obsId });

        const sub = subscribeToJobProgress(
          jobResponse.jobId,
          {
            onProgress: (status) => {
              setDownloadProgress({
                ...status,
                progress: ((completedCount + status.progress / 100) / totalObs) * 100,
              });
            },
            onCompleted: (status) => {
              completedCount++;
              // Map filter to imported data IDs
              const filterName = obs.filters?.toUpperCase();
              if (filterName && status.result?.importedDataIds) {
                filterDataMapRef.current.set(filterName, status.result.importedDataIds);
              }

              setDownloadProgress({
                ...status,
                progress: (completedCount / totalObs) * 100,
              });

              // Start next observation
              importNext(index + 1);
            },
            onFailed: (status) => {
              setDownloadError(status.error ?? `Download failed for ${obs.filters ?? obsId}`);
              // Continue to next observation — partial results are still useful
              completedCount++;
              importNext(index + 1);
            },
          },
          { obsId }
        );

        subscriptionsRef.current.push(sub);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Failed to start download.');
      }
    }

    importNext(0);
  }

  /**
   * Start composite generation (and mosaic if needed).
   */
  async function startProcessing(matchedRecipe: CompositeRecipe) {
    setCurrentStep(2);
    setProcessPhase('composite');

    try {
      const channels = buildChannelPayloads(matchedRecipe, filterDataMapRef.current);

      if (channels.length === 0) {
        setProcessError('No data available to generate composite.');
        return;
      }

      // Start async composite export via job queue
      const { jobId } = await exportNChannelCompositeAsync(
        channels,
        'png',
        95,
        2000,
        2000,
        DEFAULT_OVERALL_ADJUSTMENTS
      );

      const sub = subscribeToJobProgress(
        jobId,
        {
          onProgress: (status) => {
            setProcessProgress(status);
          },
          onCompleted: async () => {
            setProcessComplete(true);

            // Fetch the result blob
            try {
              const token = getCompositeToken();
              const headers: Record<string, string> = {};
              if (token) headers['Authorization'] = `Bearer ${token}`;

              const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, { headers });
              if (!response.ok) throw new Error(`Failed to fetch result: ${response.statusText}`);

              const blob = await response.blob();
              setCompositeBlob(blob);

              // Revoke old preview URL before creating new one
              if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);

              const url = URL.createObjectURL(blob);
              previewUrlRef.current = url;
              setPreviewUrl(url);
              setCurrentStep(3);
            } catch (err) {
              setProcessError(
                err instanceof Error ? err.message : 'Failed to fetch composite result.'
              );
            }
          },
          onFailed: (status) => {
            setProcessError(status.error ?? 'Composite generation failed.');
          },
        },
        { signalROnly: true }
      );

      subscriptionsRef.current.push(sub);
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : 'Failed to start composite generation.');
    }
  }

  /**
   * Handle adjustment changes from the result step.
   * Regenerates the composite with adjusted overall params.
   */
  async function handleAdjust(adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
  }) {
    if (!recipe) return;
    setIsExporting(true);
    setExportError(null);

    try {
      const channels = buildChannelPayloads(recipe, filterDataMapRef.current);

      // Map 0-100 slider values to stretch parameters
      // Brightness: shifts black/white points
      const bOffset = (adjustments.brightness - 50) / 100; // -0.5 to 0.5
      // Contrast: maps to gamma
      const gamma = 0.5 + (adjustments.contrast / 100) * 1.5; // 0.5 to 2.0
      // Saturation: scales channel weights
      const satScale = 0.5 + adjustments.saturation / 100; // 0.5 to 1.5

      const adjustedChannels = channels.map((ch) => ({
        ...ch,
        weight: ch.weight * satScale,
      }));

      const overall: OverallAdjustments = {
        ...DEFAULT_OVERALL_ADJUSTMENTS,
        blackPoint: Math.max(0, DEFAULT_OVERALL_ADJUSTMENTS.blackPoint - bOffset),
        whitePoint: Math.min(1, DEFAULT_OVERALL_ADJUSTMENTS.whitePoint + bOffset),
        gamma,
      };

      const { jobId } = await exportNChannelCompositeAsync(
        adjustedChannels,
        'png',
        95,
        2000,
        2000,
        overall
      );

      const sub = subscribeToJobProgress(
        jobId,
        {
          onProgress: () => {
            /* wait for completion */
          },
          onCompleted: async () => {
            try {
              const token = getCompositeToken();
              const headers: Record<string, string> = {};
              if (token) headers['Authorization'] = `Bearer ${token}`;

              const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, { headers });
              if (!response.ok) throw new Error(`Failed to fetch result: ${response.statusText}`);

              const blob = await response.blob();
              setCompositeBlob(blob);

              // Clean up old preview URL
              if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);

              const url = URL.createObjectURL(blob);
              previewUrlRef.current = url;
              setPreviewUrl(url);
            } catch (err) {
              setExportError(err instanceof Error ? err.message : 'Failed to apply adjustments.');
            } finally {
              setIsExporting(false);
            }
          },
          onFailed: (status) => {
            setExportError(status.error ?? 'Adjustment regeneration failed.');
            setIsExporting(false);
          },
        },
        { signalROnly: true }
      );

      subscriptionsRef.current.push(sub);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to start adjustment.');
      setIsExporting(false);
    }
  }

  // Error state before flow starts
  if (initError) {
    return (
      <div className="guided-create">
        <div className="guided-create-back">
          {target ? (
            <Link to={`/target/${encodeURIComponent(target)}`} className="back-link">
              &larr; Back to {target}
            </Link>
          ) : (
            <Link to="/" className="back-link">
              &larr; Back to Discovery
            </Link>
          )}
        </div>
        <h2>Create Composite</h2>
        <div className="guided-create-error">
          <p>{initError}</p>
          <Link
            to={target ? `/target/${encodeURIComponent(target)}` : '/'}
            className="guided-create-error-link"
          >
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="guided-create">
      <div className="guided-create-back">
        {target ? (
          <Link to={`/target/${encodeURIComponent(target)}`} className="back-link">
            &larr; Back to {target}
          </Link>
        ) : (
          <Link to="/" className="back-link">
            &larr; Back to Discovery
          </Link>
        )}
      </div>

      <h2>Create Composite</h2>

      <WizardStepper steps={WIZARD_STEPS} currentStep={currentStep} />

      <div className="guided-create-content">
        {currentStep === 1 && (
          <DownloadStep
            targetName={target}
            progress={downloadProgress}
            error={downloadError}
            isComplete={downloadComplete}
            onRetry={() => {
              // Reset and re-trigger by remounting
              window.location.reload();
            }}
          />
        )}

        {currentStep === 2 && (
          <ProcessStep
            targetName={target}
            recipeName={recipeName}
            requiresMosaic={recipe?.requiresMosaic ?? false}
            phase={processPhase}
            progress={processProgress}
            error={processError}
            isComplete={processComplete}
            onRetry={() => {
              if (recipe) {
                setProcessError(null);
                setProcessComplete(false);
                startProcessing(recipe);
              }
            }}
          />
        )}

        {currentStep === 3 && (
          <ResultStep
            targetName={target}
            recipeName={recipeName}
            filters={recipe?.filters ?? []}
            previewUrl={previewUrl}
            compositeBlob={compositeBlob}
            isExporting={isExporting}
            exportError={exportError}
            onAdjust={handleAdjust}
          />
        )}
      </div>
    </div>
  );
}
