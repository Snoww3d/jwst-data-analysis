import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { WizardStepper } from '../components/wizard/WizardStepper';
import { DownloadStep } from '../components/guided/DownloadStep';
import { ProcessStep } from '../components/guided/ProcessStep';
import { ResultStep } from '../components/guided/ResultStep';
import { searchByTarget, startImport } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import { exportNChannelCompositeAsync } from '../services/compositeService';
import { checkDataAvailability } from '../services/jwstDataService';
import { subscribeToJobProgress } from '../hooks/useJobProgress';
import { apiClient } from '../services/apiClient';
import { useAuth } from '../context/useAuth';
import type { ImportJobStatus, MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe, ObservationInput } from '../types/DiscoveryTypes';
import type { NChannelConfigPayload, OverallAdjustments } from '../types/CompositeTypes';
import { DEFAULT_CHANNEL_PARAMS, DEFAULT_OVERALL_ADJUSTMENTS } from '../types/CompositeTypes';
import { chromaticOrderHues, hueToHex } from '../utils/wavelengthUtils';
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
 * Falls back to chromatic-ordered colors if colorMapping is missing.
 */
function buildChannelPayloads(
  recipe: CompositeRecipe,
  filterDataMap: Map<string, string[]>
): NChannelConfigPayload[] {
  // Build fallback color mapping if the API response didn't include one
  const colorMapping =
    recipe.colorMapping ??
    Object.fromEntries(
      recipe.filters.map((f, i) => [f, hueToHex(chromaticOrderHues(recipe.filters.length)[i])])
    );

  const payloads: NChannelConfigPayload[] = [];
  for (const filter of recipe.filters) {
    const dataIds = filterDataMap.get(filter.toUpperCase()) ?? [];
    if (dataIds.length === 0) continue;
    const hexColor = colorMapping[filter] ?? '#ffffff';
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
      tObsRelease: obs.t_obs_release,
      dataProductType: obs.dataproduct_type,
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const location = useLocation();

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
  const [channelPayloads, setChannelPayloads] = useState<NChannelConfigPayload[]>([]);

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

  // Resolved observations awaiting auth to start downloads
  const [pendingObs, setPendingObs] = useState<{
    observations: MastObservationResult[];
    matched: CompositeRecipe;
  } | null>(null);

  // Step 0: Resolve recipe from target name (all public endpoints — no auth needed)
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

        // Check if data already exists in the library (anonymous — no auth needed)
        const obsIds = relevantObs.map((o) => o.obs_id).filter(Boolean) as string[];
        const availability = await checkDataAvailability(obsIds);
        if (controller.signal.aborted) return;

        // Map filter → dataIds from existing data
        const existingFilterData = new Map<string, string[]>();
        for (const obsId of obsIds) {
          const item = availability.results[obsId];
          if (item?.available && item.dataIds.length > 0) {
            const obs = relevantObs.find((o) => o.obs_id === obsId);
            const filterName = item.filter ?? obs?.filters?.toUpperCase();
            if (filterName) {
              existingFilterData.set(filterName.toUpperCase(), item.dataIds);
            }
          }
        }

        // Check which filters still need downloading
        const needsDownload = relevantObs.filter((obs) => {
          const filterKey = obs.filters?.toUpperCase();
          return filterKey && !existingFilterData.has(filterKey);
        });

        if (needsDownload.length === 0) {
          // All data exists — skip download, go straight to composite
          filterDataMapRef.current = existingFilterData;
          setDownloadComplete(true);
          startProcessing(matched);
        } else if (existingFilterData.size > 0) {
          // Some data exists — pre-populate map, only download the rest
          filterDataMapRef.current = existingFilterData;
          if (isAuthenticated) {
            startDownloads(needsDownload, matched);
          } else {
            setPendingObs({ observations: needsDownload, matched });
          }
        } else {
          // No existing data — gate on auth as before
          if (isAuthenticated) {
            startDownloads(relevantObs, matched);
          } else {
            setPendingObs({ observations: relevantObs, matched });
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setInitError(err instanceof Error ? err.message : 'Failed to resolve recipe.');
      }
    }

    resolveRecipe();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isAuthenticated handled by separate effect
  }, [target, recipeName]);

  // When user authenticates after page load, start pending downloads
  useEffect(() => {
    if (isAuthenticated && pendingObs) {
      startDownloads(pendingObs.observations, pendingObs.matched);
      setPendingObs(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startDownloads is stable closure
  }, [isAuthenticated, pendingObs]);

  /**
   * Start importing MAST observations in parallel.
   * Tracks filter -> dataId mapping as each completes.
   * Merges file-level progress from all concurrent jobs into one unified view.
   */
  function startDownloads(observations: MastObservationResult[], matchedRecipe: CompositeRecipe) {
    const totalObs = observations.length;
    let completedCount = 0;
    let failedCount = 0;
    // Per-job progress keyed by jobId — merged into a single DownloadStep view
    const jobProgressMap = new Map<string, ImportJobStatus>();

    function mergeProgress() {
      const allStatuses = Array.from(jobProgressMap.values());
      const allFiles = allStatuses.flatMap((s) => s.fileProgress ?? []);
      const totalBytes = allStatuses.reduce((sum, s) => sum + (s.totalBytes ?? 0), 0);
      const downloadedBytes = allStatuses.reduce((sum, s) => sum + (s.downloadedBytes ?? 0), 0);
      const totalSpeed = allStatuses.reduce((sum, s) => sum + (s.speedBytesPerSec ?? 0), 0);
      const overallPercent =
        totalObs > 0 ? allStatuses.reduce((sum, s) => sum + (s.progress ?? 0), 0) / totalObs : 0;

      setDownloadProgress({
        jobId: 'merged',
        obsId: 'merged',
        progress: overallPercent,
        stage: `Downloading (${completedCount}/${totalObs} complete)`,
        message: '',
        isComplete: false,
        startedAt: '',
        totalBytes,
        downloadedBytes,
        downloadProgressPercent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
        speedBytesPerSec: totalSpeed,
        fileProgress: allFiles,
      });
    }

    function checkAllDone() {
      if (completedCount + failedCount >= totalObs) {
        if (completedCount > 0) {
          setDownloadComplete(true);
          startProcessing(matchedRecipe);
        } else {
          // All failed — keep error state (already set)
        }
      }
    }

    async function startOne(obs: MastObservationResult) {
      const obsId = obs.obs_id;
      if (!obsId) {
        completedCount++;
        checkAllDone();
        return;
      }

      try {
        const jobResponse = await startImport({ obsId, calibLevel: [3] });

        const sub = subscribeToJobProgress(
          jobResponse.jobId,
          {
            onProgress: (status) => {
              jobProgressMap.set(jobResponse.jobId, status);
              mergeProgress();
            },
            onCompleted: (status) => {
              completedCount++;
              jobProgressMap.set(jobResponse.jobId, status);

              const filterName = obs.filters?.toUpperCase();
              if (filterName && status.result?.importedDataIds) {
                filterDataMapRef.current.set(filterName, status.result.importedDataIds);
              }

              mergeProgress();
              checkAllDone();
            },
            onFailed: (status) => {
              failedCount++;
              jobProgressMap.set(jobResponse.jobId, status);

              // Only set error if this is the first failure
              setDownloadError(
                (prev) => prev ?? status.error ?? `Download failed for ${obs.filters ?? obsId}`
              );
              setDownloadProgress((prev) => prev ?? status);

              mergeProgress();
              checkAllDone();
            },
          },
          { obsId }
        );

        subscriptionsRef.current.push(sub);
      } catch (err) {
        failedCount++;
        setDownloadError(
          (prev) => prev ?? (err instanceof Error ? err.message : 'Failed to start download.')
        );
        checkAllDone();
      }
    }

    // Fire all downloads in parallel
    observations.forEach((obs) => startOne(obs));
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

      setChannelPayloads(channels);

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

            // Fetch the result blob (uses apiClient for automatic 401 retry with token refresh)
            try {
              const blob = await apiClient.getBlob(`/api/jobs/${jobId}/result`);
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
   * Regenerate composite from given channels + overall adjustments.
   */
  async function regenerateComposite(
    channels: NChannelConfigPayload[],
    overall: OverallAdjustments
  ) {
    setIsExporting(true);
    setExportError(null);

    try {
      const { jobId } = await exportNChannelCompositeAsync(
        channels,
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
              const blob = await apiClient.getBlob(`/api/jobs/${jobId}/result`);
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

  /**
   * Handle overall adjustment changes from the result step.
   * Uses channelPayloads state so per-channel color/weight changes persist.
   */
  function handleAdjust(adjustments: { brightness: number; contrast: number; saturation: number }) {
    if (channelPayloads.length === 0) return;

    // Map 0-100 slider values to stretch parameters
    const bOffset = (adjustments.brightness - 50) / 100; // -0.5 to 0.5
    const gamma = 0.5 + (adjustments.contrast / 100) * 1.5; // 0.5 to 2.0
    const satScale = 0.5 + adjustments.saturation / 100; // 0.5 to 1.5

    const adjustedChannels = channelPayloads.map((ch) => ({
      ...ch,
      weight: ch.weight * satScale,
    }));

    const overall: OverallAdjustments = {
      ...DEFAULT_OVERALL_ADJUSTMENTS,
      blackPoint: Math.max(0, DEFAULT_OVERALL_ADJUSTMENTS.blackPoint - bOffset),
      whitePoint: Math.min(1, DEFAULT_OVERALL_ADJUSTMENTS.whitePoint + bOffset),
      gamma,
    };

    regenerateComposite(adjustedChannels, overall);
  }

  /**
   * Handle per-channel color/weight changes from ResultStep.
   * Updates state and triggers regeneration with current channels.
   */
  function handleChannelsChange(channels: NChannelConfigPayload[]) {
    setChannelPayloads(channels);
    regenerateComposite(channels, DEFAULT_OVERALL_ADJUSTMENTS);
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

  // Auth gate: recipe resolved but user not logged in
  if (pendingObs && !isAuthenticated && !authLoading) {
    return (
      <div className="guided-create">
        <div className="guided-create-back">
          <Link to={`/target/${encodeURIComponent(target)}`} className="back-link">
            &larr; Back to {target}
          </Link>
        </div>
        <h2>Create Composite</h2>
        <div className="guided-create-auth-gate">
          <p>Sign in to create a composite image of {target}.</p>
          <p className="guided-create-auth-hint">
            {pendingObs.observations.length} filter{pendingObs.observations.length === 1 ? '' : 's'}{' '}
            will be downloaded and combined using the {pendingObs.matched.name} recipe.
          </p>
          <Link
            to="/login"
            state={{ from: location.pathname + location.search }}
            className="guided-create-auth-cta"
          >
            Sign In to Continue
          </Link>
          <p className="guided-create-auth-register">
            Don&apos;t have an account?{' '}
            <Link to="/register" state={{ from: location.pathname + location.search }}>
              Register
            </Link>
          </p>
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
            channels={channelPayloads}
            onChannelsChange={handleChannelsChange}
            compositePageState={
              recipe
                ? {
                    initialChannels: channelPayloads.map((ch, i) => ({
                      id: `guided-ch-${Date.now()}-${i + 1}`,
                      dataIds: ch.dataIds,
                      color: ch.color,
                      label: ch.label,
                      params: {
                        stretch: ch.stretch as import('../types/CompositeTypes').StretchMethod,
                        blackPoint: ch.blackPoint,
                        whitePoint: ch.whitePoint,
                        gamma: ch.gamma,
                        asinhA: ch.asinhA,
                        curve: ch.curve as import('../types/CompositeTypes').ToneCurve,
                        weight: ch.weight,
                      },
                    })),
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
