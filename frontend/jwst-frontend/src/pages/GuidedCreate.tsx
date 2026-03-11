import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { WizardStepper } from '../components/wizard/WizardStepper';
import { DownloadStep } from '../components/guided/DownloadStep';
import { ProcessStep } from '../components/guided/ProcessStep';
import { ResultStep } from '../components/guided/ResultStep';
import { searchByTarget, startImport } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import {
  exportNChannelCompositeAsync,
  generateNChannelComposite,
} from '../services/compositeService';
import { checkDataAvailability } from '../services/jwstDataService';
import { subscribeToJobProgress } from '../hooks/useJobProgress';
import { apiClient } from '../services/apiClient';
import { useAuth } from '../context/useAuth';
import type { ImportJobStatus, MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe } from '../types/DiscoveryTypes';
import type {
  NChannelConfigPayload,
  OverallAdjustments,
  CompositePreset,
} from '../types/CompositeTypes';
import { COMPOSITE_PRESETS } from '../types/CompositeTypes';
import { chromaticOrderHues, hueToHex, hexToRgb, rgbToHue } from '../utils/wavelengthUtils';
import { toObservationInputs } from '../utils/observationUtils';
import './GuidedCreate.css';

/** Router state passed from RecipeCard to skip redundant MAST + recipe API calls */
interface GuidedCreateLocationState {
  recipe?: CompositeRecipe;
  observations?: MastObservationResult[];
}

type FlowStep = 1 | 2 | 3;

const WIZARD_STEPS = [
  { number: 1, label: 'Download' },
  { number: 2, label: 'Process' },
  { number: 3, label: 'Result' },
];

const COMPOSITE_OUTPUT = {
  outputFormat: 'png' as const,
  quality: 95,
  width: 2000,
  height: 2000,
};

/** Bicolor RGB weights for 2-filter composites (synthetic green) */
const BICOLOR_WEIGHTS: [number, number, number][] = [
  [0, 0.5, 1.0], // short wavelength → blue + half green
  [1.0, 0.5, 0], // long wavelength → red + half green
];

const DEFAULT_PRESET = COMPOSITE_PRESETS.find((p) => p.id === 'nasa') ?? COMPOSITE_PRESETS[0];

/**
 * Build NChannelConfigPayload array from recipe + imported data mappings.
 * Falls back to chromatic-ordered colors if colorMapping is missing.
 * For 2-filter recipes, uses bicolor RGB weights (synthetic green).
 */
function buildChannelPayloads(
  recipe: CompositeRecipe,
  filterDataMap: Map<string, string[]>,
  preset: CompositePreset = DEFAULT_PRESET
): NChannelConfigPayload[] {
  const isBicolor = recipe.filters.length === 2;

  // Build fallback color mapping if the API response didn't include one
  const colorMapping =
    recipe.colorMapping ??
    Object.fromEntries(
      recipe.filters.map((f, i) => [f, hueToHex(chromaticOrderHues(recipe.filters.length)[i])])
    );

  const payloads: NChannelConfigPayload[] = [];
  for (let i = 0; i < recipe.filters.length; i++) {
    const filter = recipe.filters[i];
    const dataIds = filterDataMap.get(filter.toUpperCase()) ?? [];
    if (dataIds.length === 0) continue;

    const color = isBicolor
      ? { rgb: BICOLOR_WEIGHTS[i] as [number, number, number] }
      : { hue: rgbToHue(...hexToRgb(colorMapping[filter] ?? '#ffffff')) };

    payloads.push({
      dataIds,
      color,
      label: filter,
      ...preset.channelParams,
    });
  }
  return payloads;
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
  const radiusParam = searchParams.get('radius');
  const radius = radiusParam ? parseFloat(radiusParam) : undefined;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const location = useLocation();

  // Flow state
  const [currentStep, setCurrentStep] = useState<FlowStep>(1);
  const [recipe, setRecipe] = useState<CompositeRecipe | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  // Download state
  const [downloadProgress, setDownloadProgress] = useState<ImportJobStatus | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadWarnings, setDownloadWarnings] = useState<string[]>([]);
  const [downloadComplete, setDownloadComplete] = useState(false);

  // Process state
  const [processProgress, setProcessProgress] = useState<ImportJobStatus | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processComplete, setProcessComplete] = useState(false);

  // Result state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compositeBlob, setCompositeBlob] = useState<Blob | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [channelPayloads, setChannelPayloads] = useState<NChannelConfigPayload[]>([]);
  const [activePreset, setActivePreset] = useState<CompositePreset>(DEFAULT_PRESET);

  // Refs for cleanup
  const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const filterDataMapRef = useRef<Map<string, string[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const featherStrengthRef = useRef<number | undefined>(undefined);

  /** Apply a composite result blob as the preview image. */
  function applyBlobPreview(blob: Blob) {
    setCompositeBlob(blob);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

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
    const controller = new AbortController();
    abortRef.current = controller;

    async function resolveRecipe() {
      if (!target || !recipeName) {
        setInitError('Missing target or recipe parameters.');
        setResolving(false);
        return;
      }

      setResolving(true);

      try {
        // Try to use pre-resolved recipe + observations from Router state
        // (passed by RecipeCard to skip redundant MAST search + suggestRecipes calls)
        const routerState = location.state as GuidedCreateLocationState | null;
        const preResolvedRecipe = routerState?.recipe;
        const preResolvedObs = routerState?.observations;
        const preResolved =
          preResolvedRecipe?.name === recipeName &&
          preResolvedObs != null &&
          preResolvedObs.length > 0;

        let matched: CompositeRecipe;
        let observations: MastObservationResult[];

        if (preResolved) {
          // Fast path — recipe and observations already resolved by TargetDetail
          matched = preResolvedRecipe;
          observations = preResolvedObs.filter((obs) => obs.dataproduct_type === 'image');
        } else {
          // Slow path — direct URL navigation (bookmark, shared link, retry)
          const searchResult = await searchByTarget(
            { targetName: target, radius },
            controller.signal
          );
          if (controller.signal.aborted) return;

          observations = (searchResult.results ?? []).filter(
            (obs) => obs.dataproduct_type === 'image'
          );
          if (observations.length === 0) {
            setInitError('No observations found for this target.');
            setResolving(false);
            return;
          }

          const inputs = toObservationInputs(observations);
          const recipeResponse = await suggestRecipes(
            { targetName: target, observations: inputs },
            controller.signal
          );
          if (controller.signal.aborted) return;

          const found = recipeResponse.recipes.find((r) => r.name === recipeName);
          if (!found) {
            setInitError(`Recipe "${recipeName}" not found for this target.`);
            setResolving(false);
            return;
          }
          matched = found;
        }

        setRecipe(matched);

        // Start downloads for each unique filter observation
        const recipeFilterSet = new Set(matched.filters.map((f) => f.toUpperCase()));
        const relevantObs = deduplicateByFilter(
          observations.filter((o) => o.filters && recipeFilterSet.has(o.filters.toUpperCase()))
        );

        if (relevantObs.length === 0) {
          setInitError('No matching observations found for this recipe.');
          setResolving(false);
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

        setResolving(false);

        if (needsDownload.length === 0) {
          // All data exists — skip download, go straight to composite.
          // No auth needed: the sync composite endpoint is [AllowAnonymous].
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
        setResolving(false);
      }
    }

    resolveRecipe();
    return () => {
      controller.abort();
      // Clean up any job subscriptions from previous attempt to prevent stale progress updates
      subscriptionsRef.current.forEach((s) => s.unsubscribe());
      subscriptionsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isAuthenticated handled by separate effect
  }, [target, recipeName, retryCount]);

  // When user authenticates after page load, start pending work
  useEffect(() => {
    async function startPendingWork() {
      if (!isAuthenticated || !pendingObs) return;
      if (pendingObs.observations.length === 0) {
        // All data already available — go straight to processing
        startProcessing(pendingObs.matched);
      } else {
        startDownloads(pendingObs.observations, pendingObs.matched);
      }
      setPendingObs(null);
    }
    startPendingWork();
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
      const downloadPercent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

      // Use callback form to enforce monotonic progress — never allow bars to jump backwards
      setDownloadProgress((prev) => ({
        jobId: 'merged',
        obsId: 'merged',
        progress: Math.max(overallPercent, prev?.progress ?? 0),
        stage: `Downloading (${completedCount}/${totalObs} complete)`,
        message: '',
        isComplete: false,
        startedAt: '',
        totalBytes,
        downloadedBytes: Math.max(downloadedBytes, prev?.downloadedBytes ?? 0),
        downloadProgressPercent: Math.max(downloadPercent, prev?.downloadProgressPercent ?? 0),
        speedBytesPerSec: totalSpeed,
        fileProgress: allFiles.map((f) => {
          const prevFile = prev?.fileProgress?.find((pf) => pf.filename === f.filename);
          if (!prevFile) return f;
          return {
            ...f,
            downloadedBytes: Math.max(f.downloadedBytes, prevFile.downloadedBytes),
            progressPercent: Math.max(f.progressPercent, prevFile.progressPercent),
          };
        }),
      }));
    }

    function checkAllDone() {
      if (completedCount + failedCount >= totalObs) {
        if (completedCount > 0) {
          setDownloadComplete(true);
          startProcessing(matchedRecipe);
        } else {
          // All failed — ensure a meaningful error is shown
          setDownloadError(
            (prev) => prev ?? 'All observations failed to download — no FITS products found'
          );
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

              const isNoProducts = status.error?.startsWith('NO_PRODUCTS:');
              const filterLabel = obs.filters ?? obsId;

              if (isNoProducts) {
                // Partial failure — add warning, don't block progress
                setDownloadWarnings((prev) => [
                  ...prev,
                  `${filterLabel}: no FITS products available at this calibration level`,
                ]);
              } else {
                // Real error — block
                setDownloadError(
                  (prev) => prev ?? status.error ?? `Download failed for ${filterLabel}`
                );
              }
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

    try {
      const channels = buildChannelPayloads(matchedRecipe, filterDataMapRef.current);

      if (channels.length === 0) {
        setProcessError('No data available to generate composite.');
        return;
      }

      setChannelPayloads(channels);

      if (isAuthenticated) {
        // Authenticated: use async job queue with SignalR progress
        const { jobId } = await exportNChannelCompositeAsync(
          channels,
          COMPOSITE_OUTPUT.outputFormat,
          COMPOSITE_OUTPUT.quality,
          COMPOSITE_OUTPUT.width,
          COMPOSITE_OUTPUT.height,
          activePreset.overall,
          activePreset.backgroundNeutralization
        );

        const sub = subscribeToJobProgress(
          jobId,
          {
            onProgress: (status) => {
              setProcessProgress(status);
            },
            onCompleted: async () => {
              setProcessComplete(true);

              try {
                const blob = await apiClient.getBlob(`/api/jobs/${jobId}/result`);
                applyBlobPreview(blob);
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
      } else {
        // Anonymous: use synchronous endpoint (AllowAnonymous)
        const blob = await generateNChannelComposite({
          channels,
          overall: activePreset.overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          ...COMPOSITE_OUTPUT,
        });
        setProcessComplete(true);
        applyBlobPreview(blob);
        setCurrentStep(3);
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : 'Failed to start composite generation.');
    }
  }

  /**
   * Regenerate composite from given channels + overall adjustments.
   */
  async function regenerateComposite(
    channels: NChannelConfigPayload[],
    overall: OverallAdjustments,
    featherStrength?: number
  ) {
    setIsExporting(true);
    setExportError(null);

    try {
      if (isAuthenticated) {
        // Authenticated: use async job queue
        const { jobId } = await exportNChannelCompositeAsync(
          channels,
          COMPOSITE_OUTPUT.outputFormat,
          COMPOSITE_OUTPUT.quality,
          COMPOSITE_OUTPUT.width,
          COMPOSITE_OUTPUT.height,
          overall,
          activePreset.backgroundNeutralization,
          featherStrength
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
                applyBlobPreview(blob);
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
      } else {
        // Anonymous: use synchronous endpoint
        const blob = await generateNChannelComposite({
          channels,
          overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength,
          ...COMPOSITE_OUTPUT,
        });
        applyBlobPreview(blob);
        setIsExporting(false);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to start adjustment.');
      setIsExporting(false);
    }
  }

  /**
   * Handle overall adjustment changes from the result step.
   * Uses channelPayloads state so per-channel color/weight changes persist.
   */
  function handleAdjust(adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
    featherStrength: number;
  }) {
    if (channelPayloads.length === 0) return;

    featherStrengthRef.current = adjustments.featherStrength;

    // Map 0-100 slider values to stretch parameters
    const bOffset = (adjustments.brightness - 50) / 100; // -0.5 to 0.5
    const gamma = 0.5 + (adjustments.contrast / 100) * 1.5; // 0.5 to 2.0
    const satScale = 0.5 + adjustments.saturation / 100; // 0.5 to 1.5

    const adjustedChannels = channelPayloads.map((ch) => ({
      ...ch,
      weight: ch.weight * satScale,
    }));

    const overall: OverallAdjustments = {
      ...activePreset.overall,
      blackPoint: Math.max(0, activePreset.overall.blackPoint - bOffset),
      whitePoint: Math.min(1, activePreset.overall.whitePoint + bOffset),
      gamma,
    };

    regenerateComposite(adjustedChannels, overall, adjustments.featherStrength);
  }

  /**
   * Handle per-channel color/weight changes from ResultStep.
   * Updates state and triggers regeneration with current channels.
   */
  function handleChannelsChange(channels: NChannelConfigPayload[]) {
    setChannelPayloads(channels);
    regenerateComposite(channels, activePreset.overall, featherStrengthRef.current);
  }

  /**
   * Handle stretch preset change from ResultStep.
   * Rebuilds channel payloads with the new preset's stretch params and regenerates.
   */
  function handlePresetChange(presetId: string) {
    const preset = COMPOSITE_PRESETS.find((p) => p.id === presetId);
    if (!preset || !recipe) return;

    setActivePreset(preset);

    // Rebuild channels with new preset's stretch params, preserving colors/weights
    const updatedChannels = channelPayloads.map((ch) => ({
      ...ch,
      ...preset.channelParams,
      // Preserve per-channel color and weight customizations
      color: ch.color,
      weight: ch.weight,
      label: ch.label,
      dataIds: ch.dataIds,
    }));

    setChannelPayloads(updatedChannels);
    // Reset quick adjustments by using the preset's overall directly
    // Note: featherStrength resets to default (15%) via ResultStep's preset reset
    featherStrengthRef.current = undefined;
    regenerateComposite(updatedChannels, preset.overall);
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
          <div className="guided-create-error-actions">
            <button
              className="btn-base guided-create-error-retry"
              onClick={() => {
                setInitError(null);
                setResolving(true);
                setRetryCount((c) => c + 1);
              }}
            >
              Try Again
            </button>
            <Link
              to={target ? `/target/${encodeURIComponent(target)}` : '/'}
              className="guided-create-error-link"
            >
              Go Back
            </Link>
          </div>
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

      {resolving && !initError && (
        <div className="guided-create-init-skeleton" role="status" aria-label="Loading recipe">
          <div className="skeleton-block" style={{ height: 24, width: '60%', marginBottom: 12 }} />
          <div className="skeleton-block" style={{ height: 16, width: '40%', marginBottom: 24 }} />
          <div className="skeleton-block" style={{ height: 120, width: '100%' }} />
        </div>
      )}

      <div className="guided-create-content">
        {currentStep === 1 && (
          <DownloadStep
            targetName={target}
            progress={downloadProgress}
            error={downloadError}
            warnings={downloadWarnings}
            isComplete={downloadComplete}
            onRetry={() => {
              setDownloadError(null);
              setDownloadWarnings([]);
              setDownloadProgress(null);
              setDownloadComplete(false);
              setRetryCount((c) => c + 1);
            }}
          />
        )}

        {currentStep === 2 && (
          <ProcessStep
            targetName={target}
            recipeName={recipeName}
            requiresMosaic={recipe?.requiresMosaic ?? false}
            phase={recipe?.requiresMosaic ? 'mosaic' : 'composite'}
            progress={processProgress}
            error={processError}
            isComplete={processComplete}
            channelCount={channelPayloads.length}
            fileCount={channelPayloads.reduce((sum, ch) => sum + ch.dataIds.length, 0)}
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
            activePresetId={activePreset.id}
            onPresetChange={handlePresetChange}
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
