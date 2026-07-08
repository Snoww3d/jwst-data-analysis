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
  exportNChannelComposite,
  generateNChannelComposite,
  downloadComposite,
  generateFilename,
  parseCompositeWarning,
} from '../services/compositeService';
import { checkDataAvailability } from '../services/jwstDataService';
import { subscribeToJobProgress, appendBufferedMessage } from '../hooks/useJobProgress';
import { apiClient } from '../services/apiClient';
import { ApiError } from '../services/ApiError';
import { CE_MODE } from '../config/ce';
import { describeTransientCompositeError } from '../utils/compositeErrors';
import { useAuth } from '../context/useAuth';
import { toast } from '../components/ui/toast';
import type { ImportJobStatus, MastObservationResult } from '../types/MastTypes';
import type { CompositeRecipe } from '../types/DiscoveryTypes';
import type {
  CompositeWarning,
  NChannelConfigPayload,
  OverallAdjustments,
  CompositePreset,
} from '../types/CompositeTypes';
import type { ExportFramingResult } from '../components/guided/ExportFramingPanel';
import { COMPOSITE_PRESETS } from '../types/CompositeTypes';
import {
  chromaticOrderHues,
  hueToHex,
  hexToRgb,
  rgbToHue,
  filterToInstrument,
} from '../utils/wavelengthUtils';
import { toObservationInputs, buildFilterCoverage } from '../utils/observationUtils';
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

const DEFAULT_PRESET = COMPOSITE_PRESETS.find((p) => p.id === 'auto') ?? COMPOSITE_PRESETS[0];

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
  const isAuto = preset.id === 'auto';

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

    const instrument = filterToInstrument(filter);
    const params = (instrument && preset.instrumentOverrides?.[instrument]) ?? preset.channelParams;

    payloads.push({
      dataIds,
      color,
      label: filter,
      ...params,
      ...(isAuto ? { autoStretch: true } : {}),
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
  // #1471 — rolling buffer of per-event progress messages from the engine
  // (e.g. "Reprojecting F277W (1 of 3)"). Surfaced via the LogPanel inside
  // ProcessStep. SignalR delivers one `status.message` per event; we
  // accumulate them locally with the same cap-50 / dedupe-consecutive
  // semantics as `useJobProgress` (shared via `appendBufferedMessage`).
  const [processMessages, setProcessMessages] = useState<string[]>([]);

  // Result state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [channelPayloads, setChannelPayloads] = useState<NChannelConfigPayload[]>([]);
  const [activePreset, setActivePreset] = useState<CompositePreset>(DEFAULT_PRESET);
  const [compositeWarning, setCompositeWarning] = useState<CompositeWarning | null>(null);
  // Sticky once set: when the user clicks "Continue anyway" on a memory-budget
  // 413, every subsequent regenerate / export for the same recipe carries the
  // opt-in so slider tweaks and exports don't silently re-trigger 413s after
  // the cache TTL expires. Reset by the resolveRecipe effect on [target,
  // recipeName, retryCount] changes so a different recipe doesn't inherit
  // the prior recipe's opt-in.
  const [allowForceDownscale, setAllowForceDownscale] = useState(false);

  // Refs for cleanup
  const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const filterDataMapRef = useRef<Map<string, string[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const featherStrengthRef = useRef<number | undefined>(undefined);

  /** Apply a composite result blob as the preview image. */
  function applyBlobPreview(blob: Blob) {
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

    // Recipe target changed → drop the force-downscale opt-in. The flag is
    // recipe-scoped (cache key changes per channel paths), so a Continue-anyway
    // for Recipe A must not silently apply to Recipe B.
    setAllowForceDownscale(false);

    async function resolveRecipe() {
      if (!target || !recipeName) {
        setInitError('Missing target or recipe parameters.');
        setResolving(false);
        return;
      }

      // ?fresh=true bypasses localStorage cache (useful when backend changes invalidate cached data)
      const freshParam = new URLSearchParams(window.location.search).get('fresh');
      const skipCache = freshParam === 'true' || freshParam === '1';

      setResolving(true);

      try {
        // Try to use pre-resolved recipe + observations from Router state
        // (passed by RecipeCard to skip redundant MAST search + suggestRecipes calls)
        const routerState = location.state as GuidedCreateLocationState | null;
        const preResolvedRecipe = routerState?.recipe;
        const preResolvedObs = routerState?.observations;
        const preResolved =
          !skipCache &&
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
            { targetName: target, radius, calibLevel: [3] },
            controller.signal,
            { skipCache }
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
            controller.signal,
            { skipCache }
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

        // Use the recipe's deduplicated observation_ids when available.
        // The recipe engine deduplicates c-prefix (pipeline mosaic) vs o-prefix
        // observations, always preferring o-prefix (reliably downloadable).
        // Without this, the frontend would pick arbitrary obs_ids from MAST
        // results by filter name alone, often selecting c-prefix obs_ids that
        // fail to download.
        const recipeObsIdSet = matched.observationIds?.length
          ? new Set(matched.observationIds)
          : null;

        // eslint-disable-next-line no-console -- Observability: trace recipe→download obs_id flow
        console.log(
          '[guided] Selected recipe:',
          matched.name,
          'filters:',
          matched.filters,
          'recipe obs_ids:',
          matched.observationIds ?? 'none (filter-match mode)'
        );

        const recipeFilterSet = new Set(matched.filters.map((f) => f.toUpperCase()));
        // ALL observations matching the recipe filters — availability must
        // consider every one (the library may hold a filter from an obs set
        // that doesn't sort first; Cas A regression). Dedup happens later,
        // only for choosing which obs to DOWNLOAD.
        const matchingObs = observations.filter((o) => {
          if (!o.filters || !recipeFilterSet.has(o.filters.toUpperCase())) return false;
          // If recipe specifies exact obs_ids, only include those
          if (recipeObsIdSet && o.obs_id) return recipeObsIdSet.has(o.obs_id);
          return true;
        });
        const relevantObs = deduplicateByFilter(matchingObs);

        // eslint-disable-next-line no-console -- Observability: trace which obs_ids will be downloaded
        console.log(
          '[guided] Matched observations for download:',
          relevantObs.map((o) => `${o.obs_id} (${o.filters})`)
        );

        if (relevantObs.length === 0) {
          setInitError('No matching observations found for this recipe.');
          setResolving(false);
          return;
        }

        // Check if data already exists in the library (anonymous — no auth
        // needed). Query ALL matching observations, not just the deduped
        // download candidates — any obs may hold the library copy.
        const obsIds = matchingObs.map((o) => o.obs_id).filter(Boolean) as string[];
        const availability = await checkDataAvailability(obsIds);
        if (controller.signal.aborted) return;

        // Map filter → dataIds from existing data (any covering obs wins)
        const existingFilterData = buildFilterCoverage(availability.results, matchingObs);

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
    // eslint-disable-next-line no-console -- Observability: trace download initiation with exact obs_ids being sent to MAST
    console.log(
      '[guided] Starting downloads:',
      observations.map((o) => `${o.obs_id} (${o.filters})`),
      'recipe:',
      matchedRecipe.name
    );
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
              const isS3Unavailable = status.error?.startsWith('S3_UNAVAILABLE:');
              const filterLabel = obs.filters ?? obsId;

              if (isNoProducts || isS3Unavailable) {
                // Partial failure — add warning, don't block progress.
                // S3_UNAVAILABLE means products exist but not on S3; the .NET
                // backend's auto mode will retry via HTTP.
                const reason = isS3Unavailable
                  ? 'not available via S3 cloud download'
                  : 'no downloadable files at MAST';
                setDownloadWarnings((prev) => [...prev, `${filterLabel}: ${reason}`]);
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
   *
   * @param matchedRecipe - Recipe to render.
   * @param forceDownscale - When true, opt in to a heavy memory-budget
   *   downscale instead of letting the engine refuse with HTTP 413. Set by
   *   the "Continue anyway" button after a memory-budget refusal; defaults
   *   to false so default flows still see the 413 + override prompt.
   *   Once set true, the value is persisted to component state so subsequent
   *   regenerate / export calls keep the opt-in.
   */
  async function startProcessing(matchedRecipe: CompositeRecipe, forceDownscale = false) {
    if (forceDownscale) setAllowForceDownscale(true);
    setCurrentStep(2);
    // Clear any stale error/warning from a prior run; "Continue anyway" must
    // start from a clean slate so the new outcome (success-with-warning,
    // different error, etc.) renders correctly.
    // #1471 — kickoff-reset invariant: every entry to startProcessing must
    // clear processMessages so retry / continue-anyway flows don't briefly
    // flash the previous job's last message above the new "Starting…" line.
    // No GuidedCreate.test.tsx infra in the repo today (would require
    // mocking router + auth + several services for one-line state setters);
    // tracked as follow-up. Keep all reset setters together as a single
    // logical group to make accidental drops easier to catch in review.
    setCompositeWarning(null);
    setProcessError(null);
    setProcessComplete(false);
    setProcessMessages([]);

    try {
      const channels = buildChannelPayloads(matchedRecipe, filterDataMapRef.current);

      if (channels.length === 0) {
        setProcessError('No data available to generate composite.');
        return;
      }

      // Initialize feather strength from recipe's recommendation for multi-instrument composites
      if (matchedRecipe.recommendedFeatherStrength != null) {
        featherStrengthRef.current = matchedRecipe.recommendedFeatherStrength;
      }

      setChannelPayloads(channels);

      const effectiveSharpening =
        activePreset.sharpening && activePreset.sharpening.amount > 0
          ? activePreset.sharpening
          : undefined;

      if (isAuthenticated) {
        // Authenticated: use async job queue with SignalR progress
        const { jobId } = await exportNChannelCompositeAsync(channels, {
          format: COMPOSITE_OUTPUT.outputFormat,
          quality: COMPOSITE_OUTPUT.quality,
          width: COMPOSITE_OUTPUT.width,
          height: COMPOSITE_OUTPUT.height,
          overall: activePreset.overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength: featherStrengthRef.current,
          sharpening: effectiveSharpening,
          allowForceDownscale: forceDownscale,
        });

        let cancelled = false;
        const sub = subscribeToJobProgress(
          jobId,
          {
            onProgress: (status) => {
              if (cancelled) return;
              setProcessProgress(status);
              setProcessMessages((prev) => appendBufferedMessage(prev, status.message));
            },
            onCompleted: async (status) => {
              if (cancelled) return;
              setProcessComplete(true);
              setProcessMessages((prev) => appendBufferedMessage(prev, status.message));

              try {
                const { blob, headers } = await apiClient.getBlobWithHeaders(
                  `/api/jobs/${jobId}/result`
                );
                if (cancelled) return;
                applyBlobPreview(blob);
                setCompositeWarning(parseCompositeWarning(headers));
                setCurrentStep(3);
              } catch (err) {
                if (cancelled) return;
                setProcessError(
                  err instanceof Error ? err.message : 'Failed to fetch composite result.'
                );
              }
            },
            onFailed: (status) => {
              if (cancelled) return;
              // 413 from engine surfaces as text in status.error; the HTTP code
              // is lost crossing the SignalR boundary. Engine detail still
              // appears in the error string.
              setProcessError(status.error ?? 'Composite generation failed.');
              setProcessMessages((prev) =>
                appendBufferedMessage(prev, status.error ?? status.message)
              );
            },
          },
          { signalROnly: true }
        );

        subscriptionsRef.current.push({
          unsubscribe: () => {
            cancelled = true;
            sub.unsubscribe();
          },
        });
      } else {
        // Anonymous: use synchronous endpoint (AllowAnonymous)
        const { blob, warning } = await generateNChannelComposite({
          channels,
          overall: activePreset.overall,
          sharpening: effectiveSharpening,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength: featherStrengthRef.current,
          allowForceDownscale: forceDownscale,
          ...COMPOSITE_OUTPUT,
        });
        setProcessComplete(true);
        applyBlobPreview(blob);
        setCompositeWarning(warning);
        setCurrentStep(3);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        setProcessError(err.message);
        toast.error('Composite would exceed memory budget', {
          description: err.message,
          duration: 12_000,
        });
        return;
      }
      const transient = describeTransientCompositeError(err);
      if (transient) {
        setProcessError(transient.message);
        toast.error(transient.title, { description: transient.message, duration: 12_000 });
        return;
      }
      setProcessError(err instanceof Error ? err.message : 'Failed to start composite generation.');
    }
  }

  // Track the most recent export request so the post-error "Continue anyway"
  // button can replay it with allowForceDownscale=true. Resets on a successful
  // export AND on regenerate-driven failures (which share exportError state)
  // so a stale request can't be replayed against fresh state.
  const lastExportResultRef = useRef<ExportFramingResult | null>(null);

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
    // Clear stale warning — fresh regenerate may have a different verdict.
    setCompositeWarning(null);
    // Drop any prior export-replay target so a regenerate failure surfaces
    // the Continue anyway button only when there's an actual export to retry.
    // (regenerateComposite shares exportError state with handleExport; without
    // this clear, a slider-driven failure would offer to replay an unrelated
    // export request.)
    lastExportResultRef.current = null;

    const effectiveSharpening =
      activePreset.sharpening && activePreset.sharpening.amount > 0
        ? activePreset.sharpening
        : undefined;

    try {
      if (isAuthenticated) {
        // Authenticated: use async job queue
        const { jobId } = await exportNChannelCompositeAsync(channels, {
          format: COMPOSITE_OUTPUT.outputFormat,
          quality: COMPOSITE_OUTPUT.quality,
          width: COMPOSITE_OUTPUT.width,
          height: COMPOSITE_OUTPUT.height,
          overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength,
          sharpening: effectiveSharpening,
          allowForceDownscale,
        });

        let cancelled = false;
        const sub = subscribeToJobProgress(
          jobId,
          {
            onProgress: () => {
              /* wait for completion */
            },
            onCompleted: async () => {
              if (cancelled) return;
              try {
                const { blob, headers } = await apiClient.getBlobWithHeaders(
                  `/api/jobs/${jobId}/result`
                );
                if (cancelled) return;
                applyBlobPreview(blob);
                setCompositeWarning(parseCompositeWarning(headers));
              } catch (err) {
                if (cancelled) return;
                setExportError(err instanceof Error ? err.message : 'Failed to apply adjustments.');
              } finally {
                if (!cancelled) setIsExporting(false);
              }
            },
            onFailed: (status) => {
              if (cancelled) return;
              // 413 from engine surfaces here as `status.error` text only — the
              // HTTP status code is lost crossing the SignalR job-failure boundary.
              // Engine detail still appears in the error string.
              setExportError(status.error ?? 'Adjustment regeneration failed.');
              setIsExporting(false);
            },
          },
          { signalROnly: true }
        );

        subscriptionsRef.current.push({
          unsubscribe: () => {
            cancelled = true;
            sub.unsubscribe();
          },
        });
      } else {
        // Anonymous: use synchronous endpoint
        const { blob, warning } = await generateNChannelComposite({
          channels,
          overall,
          sharpening: effectiveSharpening,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength,
          allowForceDownscale,
          ...COMPOSITE_OUTPUT,
        });
        applyBlobPreview(blob);
        setCompositeWarning(warning);
        setIsExporting(false);
      }
    } catch (err) {
      const transient = describeTransientCompositeError(err);
      if (transient) {
        setExportError(transient.message);
        toast.error(transient.title, { description: transient.message, duration: 12_000 });
        setIsExporting(false);
        return;
      }
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
    const isAuto = preset.id === 'auto';

    // Rebuild channels with new preset's stretch params, preserving colors/weights
    const updatedChannels = channelPayloads.map((ch) => {
      const instrument = filterToInstrument(ch.label ?? '');
      const params =
        (instrument && preset.instrumentOverrides?.[instrument]) ?? preset.channelParams;
      return {
        ...ch,
        ...params,
        // Preserve per-channel color and weight customizations
        color: ch.color,
        weight: ch.weight,
        label: ch.label,
        dataIds: ch.dataIds,
        ...(isAuto ? { autoStretch: true } : {}),
      };
    });

    setChannelPayloads(updatedChannels);
    // Reset quick adjustments by using the preset's overall directly
    // Note: featherStrength resets to default (0%) via ResultStep's preset reset
    featherStrengthRef.current = undefined;
    regenerateComposite(updatedChannels, preset.overall);
  }

  /**
   * Handle export from the framing panel — generates a full-resolution composite
   * with server-side rotation, zoom, and pan applied.
   */
  async function handleExport(result: ExportFramingResult, forceDownscaleOverride = false) {
    if (channelPayloads.length === 0) return;
    lastExportResultRef.current = result;
    setIsExporting(true);
    setExportError(null);
    // Clear stale warning — fresh export may have a different verdict.
    setCompositeWarning(null);
    // The state setter is async; use the override directly when the caller
    // explicitly opted in, otherwise read from sticky state.
    const useForceDownscale = forceDownscaleOverride || allowForceDownscale;
    if (forceDownscaleOverride) setAllowForceDownscale(true);

    const framing = {
      rotationDegrees: result.rotationDegrees,
      cropCenterX: result.cropCenterX,
      cropCenterY: result.cropCenterY,
      cropZoom: result.cropZoom,
    };

    const effectiveSharpening =
      activePreset.sharpening && activePreset.sharpening.amount > 0
        ? activePreset.sharpening
        : undefined;

    try {
      if (isAuthenticated) {
        const { jobId } = await exportNChannelCompositeAsync(channelPayloads, {
          format: result.format,
          quality: result.format === 'jpeg' ? 92 : 95,
          width: result.width,
          height: result.height,
          overall: activePreset.overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength: featherStrengthRef.current,
          framing,
          sharpening: effectiveSharpening,
          allowForceDownscale: useForceDownscale,
        });

        let cancelled = false;
        const sub = subscribeToJobProgress(
          jobId,
          {
            onProgress: () => {},
            onCompleted: async () => {
              if (cancelled) return;
              try {
                const { blob, headers } = await apiClient.getBlobWithHeaders(
                  `/api/jobs/${jobId}/result`
                );
                if (cancelled) return;
                downloadComposite(blob, generateFilename(result.format));
                lastExportResultRef.current = null;
                setCompositeWarning(parseCompositeWarning(headers));
              } catch (err) {
                if (cancelled) return;
                setExportError(err instanceof Error ? err.message : 'Failed to download export.');
              } finally {
                if (!cancelled) setIsExporting(false);
              }
            },
            onFailed: (status) => {
              if (cancelled) return;
              setExportError(status.error ?? 'Export failed.');
              setIsExporting(false);
            },
          },
          { signalROnly: true }
        );
        subscriptionsRef.current.push({
          unsubscribe: () => {
            cancelled = true;
            sub.unsubscribe();
          },
        });
      } else {
        const { blob, warning } = await exportNChannelComposite(channelPayloads, {
          format: result.format,
          quality: result.format === 'jpeg' ? 92 : 95,
          width: result.width,
          height: result.height,
          overall: activePreset.overall,
          backgroundNeutralization: activePreset.backgroundNeutralization,
          featherStrength: featherStrengthRef.current,
          framing,
          sharpening: effectiveSharpening,
          allowForceDownscale: useForceDownscale,
        });
        // Surface the same downscale/over-budget banner the preview and the
        // authenticated export path show — without this, anonymous users got a
        // lower-resolution file with no indication anything had been reduced. (#1445)
        setCompositeWarning(warning);
        downloadComposite(blob, generateFilename(result.format));
        lastExportResultRef.current = null;
        setIsExporting(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        setExportError(err.message);
        toast.error('Composite would exceed memory budget', {
          description: err.message,
          duration: 12_000,
        });
        setIsExporting(false);
        return;
      }
      const transient = describeTransientCompositeError(err);
      if (transient) {
        setExportError(transient.message);
        toast.error(transient.title, { description: transient.message, duration: 12_000 });
        setIsExporting(false);
        return;
      }
      setExportError(err instanceof Error ? err.message : 'Export failed.');
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
        {CE_MODE ? (
          <div className="guided-create-auth-gate">
            <p>This target&apos;s data isn&apos;t in the Community Edition library yet.</p>
            <p className="guided-create-auth-hint">
              The Community Edition ships with pre-loaded data for the featured targets — pick one
              of those to create a composite in your browser, no account needed.
            </p>
            <Link to="/" className="guided-create-auth-cta">
              Browse Featured Targets
            </Link>
          </div>
        ) : (
          <div className="guided-create-auth-gate">
            <p>Sign in to create a composite image of {target}.</p>
            <p className="guided-create-auth-hint">
              {pendingObs.observations.length} filter
              {pendingObs.observations.length === 1 ? '' : 's'} will be downloaded and combined
              using the {pendingObs.matched.name} recipe.
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
        )}
      </div>
    );
  }

  return (
    <div className={`guided-create${currentStep === 3 ? ' guided-create--wide' : ''}`}>
      <div className="guided-create-header">
        {target ? (
          <Link to={`/target/${encodeURIComponent(target)}`} className="back-link">
            &larr; {target}
          </Link>
        ) : (
          <Link to="/" className="back-link">
            &larr; Discovery
          </Link>
        )}
        <h2>Create Composite</h2>
        {currentStep === 3 && <WizardStepper steps={WIZARD_STEPS} currentStep={currentStep} />}
      </div>

      {currentStep !== 3 && <WizardStepper steps={WIZARD_STEPS} currentStep={currentStep} />}

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
            messages={processMessages}
            error={processError}
            isComplete={processComplete}
            channelCount={channelPayloads.length}
            fileCount={channelPayloads.reduce((sum, ch) => sum + ch.dataIds.length, 0)}
            filters={recipe?.filters}
            colorMapping={recipe?.colorMapping}
            onRetry={() => {
              if (recipe) {
                setProcessError(null);
                setProcessComplete(false);
                startProcessing(recipe);
              }
            }}
            onContinueAnyway={
              recipe ? () => startProcessing(recipe, /* allowForceDownscale */ true) : undefined
            }
          />
        )}

        {currentStep === 3 && (
          <ResultStep
            targetName={target}
            recipeName={recipeName}
            filters={recipe?.filters ?? []}
            previewUrl={previewUrl}
            isExporting={isExporting}
            exportError={exportError}
            compositeWarning={compositeWarning}
            onAdjust={handleAdjust}
            channels={channelPayloads}
            onChannelsChange={handleChannelsChange}
            activePresetId={activePreset.id}
            onPresetChange={handlePresetChange}
            onExport={handleExport}
            onContinueAnyway={
              lastExportResultRef.current
                ? () => {
                    const last = lastExportResultRef.current;
                    if (last) handleExport(last, /* forceDownscaleOverride */ true);
                  }
                : undefined
            }
            initialFeatherStrength={
              recipe?.recommendedFeatherStrength
                ? Math.round(recipe.recommendedFeatherStrength * 100)
                : undefined
            }
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
