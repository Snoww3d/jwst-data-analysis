import React, { useCallback, useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  NChannelState,
  NChannelConfigPayload,
  ChannelStretchParams,
  ChannelAnalysis,
  ExportOptions,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_OVERALL_ADJUSTMENTS,
  DEFAULT_SHARPENING,
  DEFAULT_SATURATION,
  OverallAdjustments,
  SharpeningConfig,
  SaturationConfig,
  SavedStretchPreset,
  isDefaultSaturation,
  StretchMethod,
  COMPOSITE_PRESETS,
  CompositePreset,
  CompositeWarning,
  STRETCH_OPTIONS,
  SAVED_PRESETS_STORAGE_KEY,
} from '../../types/CompositeTypes';
import { compositeService, ApiError } from '../../services';
import { parseCompositeWarning } from '../../services/compositeService';
import { useAuth } from '../../context/useAuth';
import { CompositeWarningBanner } from '../CompositeWarningBanner';
import { LogPanel } from './LogPanel';
import { getFilterLabel, channelColorToHex, filterToInstrument } from '../../utils/wavelengthUtils';
import { useJobProgress } from '../../hooks/useJobProgress';
import { useSimulatedProgress } from '../../hooks/useSimulatedProgress';
import { apiClient } from '../../services/apiClient';
import StretchControls, { StretchParams } from '../StretchControls';
import HistogramPanel, { HistogramData, HistogramStats } from '../HistogramPanel';
import './CompositePreviewStep.css';

/**
 * Map raw `JobProgressUpdate.stage` values from the backend to user-friendly
 * labels for the preview status line. Unknown stages fall back to the raw
 * value so newly-added engine stages still render something coherent without
 * a frontend deploy.
 */
const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  generating: 'Generating composite',
  mosaic: 'Building observation mosaic',
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface CompositePreviewStepProps {
  selectedImages: JwstDataModel[];
  channels: NChannelState[];
  onChannelsChange: (channels: NChannelState[]) => void;
  onExportComplete?: () => void;
}

/**
 * Step 2: Preview & Export with overall + per-channel stretch controls — N-channel version
 */
export const CompositePreviewStep: React.FC<CompositePreviewStepProps> = ({
  selectedImages,
  channels,
  onChannelsChange,
  onExportComplete,
}) => {
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [backgroundNeutralization, setBackgroundNeutralization] = useState(true);
  const [overallAdjustments, setOverallAdjustments] = useState<OverallAdjustments>({
    ...DEFAULT_OVERALL_ADJUSTMENTS,
  });
  const [sharpening, setSharpening] = useState<SharpeningConfig>({
    ...DEFAULT_SHARPENING,
  });
  const [saturation, setSaturation] = useState<SaturationConfig>({
    ...DEFAULT_SATURATION,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<CompositeWarning | null>(null);
  const [mosaicRetrying, setMosaicRetrying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Sticky once set: a single click of "Continue anyway" on the preview path
  // also makes the export path opt in. Otherwise the preview succeeds via
  // force-downscale, the user adjusts sliders and exports, and the export
  // re-hits 413 with no path forward.
  const [allowForceDownscale, setAllowForceDownscale] = useState(false);
  const [exportWarning, setExportWarning] = useState<CompositeWarning | null>(null);
  const exportFormatRef = useRef<'png' | 'jpeg'>('png');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    progress: jobProgress,
    isComplete: jobComplete,
    error: jobError,
  } = useJobProgress(activeJobId, undefined, true);

  const { isAuthenticated } = useAuth();

  // #1470 — async preview path. Authenticated wizard preview goes through the
  // same job queue as export, so the user sees real progress (stage label,
  // elapsed time) instead of `useSimulatedProgress`. Anonymous users stay on
  // the sync endpoint because JobProgressHub requires authentication.
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previewStartedAt, setPreviewStartedAt] = useState<number | null>(null);
  const [previewElapsed, setPreviewElapsed] = useState(0);
  // Held in a ref so the abort handler can cancel the active preview job
  // without depending on the latest state value.
  const previewJobIdRef = useRef<string | null>(null);
  const {
    progress: previewJobProgress,
    isComplete: previewJobComplete,
    error: previewJobError,
    messages: previewJobMessages,
  } = useJobProgress(previewJobId, undefined, true);

  const mosaicRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Simulated progress: slowly climb from last real progress toward ~90%
  // so the user sees continuous feedback during long processing.
  const displayProgress = useSimulatedProgress(exporting, jobComplete, jobProgress?.progress ?? 0);
  const [channelCollapsed, setChannelCollapsed] = useState<Record<string, boolean>>(() => {
    const collapsed: Record<string, boolean> = {};
    channels.forEach((ch) => {
      collapsed[ch.id] = true;
    });
    return collapsed;
  });
  // Sync channelCollapsed when channels change (adjust state during render)
  const [prevChannels, setPrevChannels] = useState(channels);
  if (channels !== prevChannels) {
    setPrevChannels(channels);
    setChannelCollapsed((prev) => {
      const next = { ...prev };
      for (const ch of channels) {
        if (!(ch.id in next)) {
          next[ch.id] = true;
        }
      }
      return next;
    });
  }

  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [perChannelExpanded, setPerChannelExpanded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [beforePreviewUrl, setBeforePreviewUrl] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [savedPresets, setSavedPresets] = useState<SavedStretchPreset[]>(() => {
    try {
      const stored = localStorage.getItem(SAVED_PRESETS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [histogramCollapsed, setHistogramCollapsed] = useState<Record<string, boolean>>({});
  const [analysisCardCollapsed, setAnalysisCardCollapsed] = useState<Record<string, boolean>>({});
  const analyzeControllerRef = useRef<AbortController | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const beforePreviewUrlRef = useRef<string | null>(null);

  const handleApplyPreset = (preset: CompositePreset) => {
    setActivePreset(preset.id);
    setOverallAdjustments({ ...preset.overall });
    setSharpening({ ...(preset.sharpening ?? DEFAULT_SHARPENING) });
    setSaturation({ ...(preset.saturation ?? DEFAULT_SATURATION) });
    setBackgroundNeutralization(preset.backgroundNeutralization);
    onChannelsChange(
      channels.map((ch) => {
        // Prefer wavelengthUm (reliable even when label is a color name like "Red")
        const instrument =
          ch.wavelengthUm != null
            ? ch.wavelengthUm >= 5.0
              ? 'MIRI'
              : 'NIRCAM'
            : filterToInstrument(ch.label ?? '');
        const params =
          (instrument && preset.instrumentOverrides?.[instrument]) ?? preset.channelParams;
        return {
          ...ch,
          params: { ...params },
        };
      })
    );
  };

  const handleChannelParamChange = (channelId: string, params: StretchParams) => {
    setActivePreset(null);
    onChannelsChange(
      channels.map((ch) => {
        if (ch.id !== channelId) return ch;
        const current = ch.params || DEFAULT_CHANNEL_PARAMS;
        const merged: ChannelStretchParams = {
          stretch: (params.stretch as StretchMethod) || current.stretch,
          gamma: params.gamma ?? current.gamma,
          blackPoint: params.blackPoint ?? current.blackPoint,
          whitePoint: params.whitePoint ?? current.whitePoint,
          asinhA: params.asinhA ?? current.asinhA,
          curve: params.curve || current.curve,
          weight: params.weight ?? current.weight,
        };
        return { ...ch, params: merged };
      })
    );
  };

  const toggleChannelCollapsed = (channelId: string) => {
    setChannelCollapsed((prev) => ({ ...prev, [channelId]: !prev[channelId] }));
  };

  // Drag-and-drop channel swapping
  const [swapDragOver, setSwapDragOver] = useState<string | null>(null);

  const handleSwapDragStart = useCallback((e: React.DragEvent, channelId: string) => {
    e.dataTransfer.setData('text/channel-swap', channelId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleSwapDragOver = useCallback((e: React.DragEvent, channelId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setSwapDragOver(channelId);
  }, []);

  const handleSwapDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setSwapDragOver(null);
    }
  }, []);

  const handleSwapDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      setSwapDragOver(null);

      const sourceId = e.dataTransfer.getData('text/channel-swap');
      if (!sourceId || sourceId === targetId) return;

      const sourceIdx = channels.findIndex((ch) => ch.id === sourceId);
      const targetIdx = channels.findIndex((ch) => ch.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;

      // Swap channels in the array
      const newChannels = [...channels];
      [newChannels[sourceIdx], newChannels[targetIdx]] = [
        newChannels[targetIdx],
        newChannels[sourceIdx],
      ];
      onChannelsChange(newChannels);
    },
    [channels, onChannelsChange]
  );

  const getImagesForChannel = (channel: NChannelState): JwstDataModel[] => {
    return channel.dataIds
      .map((id) => selectedImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  };

  // Build N-channel config payloads from channels state
  const buildPayloads = (): NChannelConfigPayload[] => {
    const isAuto = activePreset === 'auto';
    return channels
      .filter((ch) => ch.dataIds.length > 0)
      .map((ch) => ({
        dataIds: ch.dataIds,
        color: ch.color,
        label: ch.label,
        wavelengthUm: ch.wavelengthUm,
        stretch: ch.params.stretch,
        blackPoint: ch.params.blackPoint,
        whitePoint: ch.params.whitePoint,
        gamma: ch.params.gamma,
        asinhA: ch.params.asinhA,
        curve: ch.params.curve,
        weight: ch.params.weight,
        ...(isAuto ? { autoStretch: true } : {}),
      }));
  };

  // Convert backend snake_case analysis to frontend ChannelAnalysis
  const mapAnalysisResult = (raw: Record<string, unknown>): ChannelAnalysis => {
    const rawMeta = raw.meta as Record<string, unknown>;
    const rawHist = raw.histogram as Record<string, unknown>;
    const rawStats = raw.stats as Record<string, unknown>;
    const rawParams = raw.params as Record<string, unknown>;
    return {
      channelName: raw.channel_name as string,
      label: (raw.label as string | null) ?? null,
      params: {
        stretch: ((rawParams.stretch as string) || 'asinh') as ChannelStretchParams['stretch'],
        blackPoint: (rawParams.black_point as number) ?? 0,
        whitePoint: (rawParams.white_point as number) ?? 1,
        gamma: (rawParams.gamma as number) ?? 1,
        asinhA: (rawParams.asinh_a as number) ?? 0.05,
        curve: ((rawParams.curve as string) || 'linear') as ChannelStretchParams['curve'],
        weight: 1.0,
      },
      histogram: {
        counts: rawHist.counts as number[],
        binCenters: rawHist.bin_centers as number[],
        binEdges: rawHist.bin_edges as number[],
        nBins: rawHist.n_bins as number,
      },
      meta: {
        dynamicRange: rawMeta.dynamic_range as number,
        noise: rawMeta.noise as number,
        snr: rawMeta.snr as number,
        hdrDetected: rawMeta.hdr_detected as boolean,
        curveReason: rawMeta.curve_reason as string,
        instrumentAdjusted: rawMeta.instrument_adjusted as boolean,
        validPixels: rawMeta.valid_pixels as number,
        zeroCoverageFrac: rawMeta.zero_coverage_frac as number,
      },
      stats: {
        min: rawStats.min as number,
        max: rawStats.max as number,
        mean: rawStats.mean as number,
        std: rawStats.std as number,
      },
    };
  };

  // Analyze a single channel and apply auto-stretch params (lock-and-refine)
  const handleAutoChannel = async (channelId: string) => {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch || ch.dataIds.length === 0) return;

    setAnalyzing(true);
    if (analyzeControllerRef.current) analyzeControllerRef.current.abort();
    const controller = new AbortController();
    analyzeControllerRef.current = controller;

    try {
      // Build a single-channel payload directly instead of filtering from all payloads,
      // which could match wrong channels if they share dataIds
      const singlePayload: NChannelConfigPayload[] = [
        {
          dataIds: ch.dataIds,
          color: ch.color,
          label: ch.label,
          wavelengthUm: ch.wavelengthUm,
          stretch: ch.params.stretch,
          blackPoint: ch.params.blackPoint,
          whitePoint: ch.params.whitePoint,
          gamma: ch.params.gamma,
          asinhA: ch.params.asinhA,
          curve: ch.params.curve,
          weight: ch.params.weight,
        },
      ];

      const response = await compositeService.analyzeChannels(
        singlePayload,
        backgroundNeutralization,
        controller.signal
      );

      if (response.channels.length > 0) {
        const analysis = mapAnalysisResult(response.channels[0] as Record<string, unknown>);
        onChannelsChange(
          channels.map((c) => {
            if (c.id !== channelId) return c;
            return {
              ...c,
              params: { ...analysis.params, weight: c.params.weight },
              analysis,
            };
          })
        );
        setActivePreset(null);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Auto-stretch analysis error:', err);
        setPreviewError('Auto-stretch analysis failed. Try again or adjust parameters manually.');
      }
    } finally {
      if (analyzeControllerRef.current === controller) {
        setAnalyzing(false);
      }
    }
  };

  // Analyze all channels at once
  const handleAutoAll = async () => {
    const payloads = buildPayloads();
    if (payloads.length === 0) return;

    // Capture current preview for before/after comparison
    if (previewUrl) {
      // Revoke any previous "before" URL that's no longer needed
      if (beforePreviewUrlRef.current && beforePreviewUrlRef.current !== previewUrl) {
        URL.revokeObjectURL(beforePreviewUrlRef.current);
      }
      beforePreviewUrlRef.current = previewUrl;
      setBeforePreviewUrl(previewUrl);
      setShowBefore(false);
    }

    setAnalyzing(true);
    if (analyzeControllerRef.current) analyzeControllerRef.current.abort();
    const controller = new AbortController();
    analyzeControllerRef.current = controller;

    try {
      const response = await compositeService.analyzeChannels(
        payloads,
        backgroundNeutralization,
        controller.signal
      );

      const analysisResults = response.channels.map((raw) =>
        mapAnalysisResult(raw as Record<string, unknown>)
      );

      // Map analysis results back to channels by index (same order as payloads)
      let resultIdx = 0;
      onChannelsChange(
        channels.map((ch) => {
          if (ch.dataIds.length === 0) return ch;
          const analysis = analysisResults[resultIdx];
          resultIdx++;
          if (!analysis) return ch;
          return {
            ...ch,
            params: { ...analysis.params, weight: ch.params.weight },
            analysis,
          };
        })
      );
      setActivePreset(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Auto-stretch analysis error:', err);
        setPreviewError('Auto-stretch analysis failed. Try again or adjust parameters manually.');
      }
    } finally {
      if (analyzeControllerRef.current === controller) {
        setAnalyzing(false);
      }
    }
  };

  // Saved presets — persist to localStorage
  const persistPresets = (presets: SavedStretchPreset[]) => {
    setSavedPresets(presets);
    try {
      localStorage.setItem(SAVED_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch {
      // QuotaExceededError — silently ignore
    }
  };

  const handleSavePreset = () => {
    const name = prompt('Preset name:');
    if (!name?.trim()) return;

    const preset: SavedStretchPreset = {
      id: `saved-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      channelParams: channels[0]?.params ?? { ...DEFAULT_CHANNEL_PARAMS },
      overall: { ...overallAdjustments },
      sharpening: sharpening.amount > 0 ? { ...sharpening } : undefined,
      saturation: !isDefaultSaturation(saturation) ? { ...saturation } : undefined,
      backgroundNeutralization,
    };
    persistPresets([...savedPresets, preset]);
  };

  const handleLoadPreset = (preset: SavedStretchPreset) => {
    setActivePreset(null);
    setOverallAdjustments({ ...preset.overall });
    if (preset.sharpening) setSharpening({ ...preset.sharpening });
    if (preset.saturation) setSaturation({ ...preset.saturation });
    setBackgroundNeutralization(preset.backgroundNeutralization);
    onChannelsChange(
      channels.map((ch) => ({
        ...ch,
        params: { ...preset.channelParams, weight: ch.params.weight },
      }))
    );
  };

  const handleDeletePreset = (presetId: string) => {
    persistPresets(savedPresets.filter((p) => p.id !== presetId));
  };

  // Debounced preview regeneration when channels or overall adjustments change.
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      generatePreview();
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, overallAdjustments, sharpening, saturation, backgroundNeutralization]);

  // Cleanup object URL, in-flight request, and timers on unmount.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (beforePreviewUrlRef.current && beforePreviewUrlRef.current !== previewUrlRef.current) {
        URL.revokeObjectURL(beforePreviewUrlRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (analyzeControllerRef.current) {
        analyzeControllerRef.current.abort();
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (mosaicRetryTimerRef.current) {
        clearTimeout(mosaicRetryTimerRef.current);
      }
      // Cancel any in-flight preview job on unmount so the wizard navigating
      // away doesn't leave the engine generating a result nobody will fetch.
      const inflightPreviewJobId = previewJobIdRef.current;
      if (inflightPreviewJobId) {
        apiClient.post(`/api/jobs/${inflightPreviewJobId}/cancel`, undefined).catch(() => {});
      }
    };
  }, []);

  // Map a thrown ApiError (sync path) or a fake-shaped error (async failure
  // surfaced via SignalR) into the existing previewError + mosaicRetrying
  // state used by the inline banner.
  const handlePreviewError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        // Observation mosaic is being built — auto-retry after Retry-After delay
        setPreviewError(null);
        setMosaicRetrying(true);
        if (mosaicRetryTimerRef.current) {
          clearTimeout(mosaicRetryTimerRef.current);
        }
        mosaicRetryTimerRef.current = setTimeout(() => {
          setMosaicRetrying(false);
          generatePreview();
        }, 30_000);
      } else if (err instanceof ApiError && err.status === 413) {
        // Memory budget exceeded — engine detail names the env vars to tune.
        // Inline preview error is the user's focal point on this screen, so
        // a toast on top would just duplicate the same text. Inline only.
        setMosaicRetrying(false);
        if (previewUrlRef.current && previewUrlRef.current !== beforePreviewUrl) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
          setPreviewUrl(null);
        }
        setPreviewError(err.message);
        console.error('Preview generation 413:', err);
      } else {
        setMosaicRetrying(false);
        const detail = err instanceof ApiError ? err.message : 'Failed to generate preview';
        setPreviewError(detail);
        console.error('Preview generation error:', err);
      }
    },
    // generatePreview is defined below; the recursive 30s retry uses the
    // closure-captured reference at fire time, which works for our purposes.
    // eslint-disable-next-line @eslint-react/exhaustive-deps, react-hooks/exhaustive-deps -- intentional cycle, see comment
    [beforePreviewUrl]
  );

  const generatePreview = async (forceDownscaleOptIn = false) => {
    const payloads = buildPayloads();
    if (payloads.length === 0) return;

    // Sticky opt-in: once the user clicks "Continue anyway" via this call,
    // every subsequent debounced re-render of the preview AND the export path
    // carry the flag. Without this, slider tweaks would silently 413 once the
    // engine cache TTL expires.
    if (forceDownscaleOptIn) setAllowForceDownscale(true);
    const effectiveAllowForce = allowForceDownscale || forceDownscaleOptIn;

    setPreviewLoading(true);
    setPreviewError(null);
    // Clear stale warning before kicking off — both the inline banner and
    // any prior toast are tied to the previous result.
    setPreviewWarning(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Cancel a previously-active preview job (if any) on the async path before
    // starting a new one. Fire-and-forget — the background worker checks
    // IsCancelRequested before completing the job, so the result write and
    // notification are skipped. Engine compute work already in flight is NOT
    // preempted (that's out of scope for #1470 — fine-grained mid-stage
    // cancellation lives with engine streaming in #1471).
    const priorPreviewJobId = previewJobIdRef.current;
    if (isAuthenticated && priorPreviewJobId) {
      apiClient.post(`/api/jobs/${priorPreviewJobId}/cancel`, undefined).catch(() => {
        // Best-effort cancel — engine may have already completed or job may
        // be unknown to the tracker.
      });
      previewJobIdRef.current = null;
      setPreviewJobId(null);
    }

    const previewOptions = {
      previewSize: 1000,
      overall: overallAdjustments,
      abortSignal: controller.signal,
      backgroundNeutralization,
      sharpening: sharpening.amount > 0 ? sharpening : undefined,
      saturation: !isDefaultSaturation(saturation) ? saturation : undefined,
      allowForceDownscale: effectiveAllowForce,
    };

    if (isAuthenticated) {
      // Async path: kick off a job, let the result-watching effect handle
      // completion. previewLoading stays true until that effect resolves.
      setPreviewElapsed(0);
      setPreviewStartedAt(Date.now());
      try {
        const { jobId } = await compositeService.generateNChannelPreviewAsync(
          payloads,
          previewOptions
        );
        if (controller.signal.aborted) {
          // Slider superseded between POST and response — cancel the just-created job.
          apiClient.post(`/api/jobs/${jobId}/cancel`, undefined).catch(() => {});
          return;
        }
        previewJobIdRef.current = jobId;
        setPreviewJobId(jobId);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        handlePreviewError(err);
        if (abortControllerRef.current === controller) {
          setPreviewLoading(false);
          setPreviewStartedAt(null);
        }
      }
      return;
    }

    // Anonymous: synchronous endpoint (JobProgressHub requires auth).
    try {
      const { blob, warning } = await compositeService.generateNChannelPreview(
        payloads,
        previewOptions
      );

      if (previewUrlRef.current && previewUrlRef.current !== beforePreviewUrl) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      const nextPreviewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = nextPreviewUrl;
      setPreviewUrl(nextPreviewUrl);
      setPreviewWarning(warning);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlePreviewError(err);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setPreviewLoading(false);
      }
    }
  };

  // #1470 — Auth-flip recovery: if the user's session expires (token refresh
  // failure, manual logout) while a preview job is in flight, the completion
  // and failure effects below short-circuit on !isAuthenticated and would
  // leave the UI stuck on "Generating..." forever. Drop the in-flight job
  // state so the next user action (or rerender) re-kicks the sync path.
  useEffect(() => {
    if (isAuthenticated || !previewJobId) return;
    previewJobIdRef.current = null;
    setPreviewJobId(null);
    setPreviewLoading(false);
    setPreviewStartedAt(null);
  }, [isAuthenticated, previewJobId]);

  // #1470 — Tick elapsed seconds while a preview job is pending so the status
  // line ("Generating composite · 0:42") advances even between SignalR events.
  // Guarded on isAuthenticated so a mid-preview logout (token expired) stops
  // the counter rather than incrementing forever against an orphaned job.
  useEffect(() => {
    if (!isAuthenticated || !previewStartedAt || !previewLoading || !previewJobId) return;
    const interval = setInterval(() => {
      setPreviewElapsed(Math.floor((Date.now() - previewStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, previewStartedAt, previewLoading, previewJobId]);

  // #1470 — Async preview completion: fetch the blob from the result endpoint
  // and apply it as the new preview URL, mirroring the export path.
  useEffect(() => {
    if (!isAuthenticated || !previewJobId || !previewJobComplete) return;
    if (previewJobError) {
      // Failure handled by the next effect.
      return;
    }

    let cancelled = false;
    const jobId = previewJobId;

    (async () => {
      try {
        const { blob, headers } = await apiClient.getBlobWithHeaders(`/api/jobs/${jobId}/result`);
        if (cancelled) return;
        if (previewUrlRef.current && previewUrlRef.current !== beforePreviewUrl) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const nextPreviewUrl = URL.createObjectURL(blob);
        previewUrlRef.current = nextPreviewUrl;
        setPreviewUrl(nextPreviewUrl);
        setPreviewWarning(parseCompositeWarning(headers));
      } catch (err) {
        if (!cancelled) {
          handlePreviewError(err);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
          previewJobIdRef.current = null;
          setPreviewJobId(null);
          setPreviewStartedAt(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    previewJobId,
    previewJobComplete,
    previewJobError,
    beforePreviewUrl,
    handlePreviewError,
  ]);

  // #1470 — Async preview failure: surface the job's error message via the
  // existing previewError state. The MEMORY_BUDGET: prefix is preserved so
  // parseMemoryBudgetError() at render time still drives "Continue anyway".
  useEffect(() => {
    if (!isAuthenticated || !previewJobId || !previewJobError) return;
    setMosaicRetrying(false);
    if (previewJobError.startsWith('MEMORY_BUDGET:')) {
      if (previewUrlRef.current && previewUrlRef.current !== beforePreviewUrl) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
      }
    }
    setPreviewError(previewJobError);
    console.error('Preview job failed:', previewJobError);
    setPreviewLoading(false);
    previewJobIdRef.current = null;
    setPreviewJobId(null);
    setPreviewStartedAt(null);
  }, [isAuthenticated, previewJobId, previewJobError, beforePreviewUrl]);

  const handleExportError = useCallback((error: string) => {
    setExportError(error);
    setExporting(false);
    setActiveJobId(null);
  }, []);

  const onExportCompleteRef = useRef(onExportComplete);
  onExportCompleteRef.current = onExportComplete;

  useEffect(() => {
    if (!jobComplete || !activeJobId) return;

    if (jobError) {
      handleExportError(jobError);
      return;
    }

    let cancelled = false;
    const jobId = activeJobId;
    const format = exportFormatRef.current;

    // Job completed — fetch the result blob and trigger download
    const downloadResult = async () => {
      try {
        const { blob, headers } = await apiClient.getBlobWithHeaders(`/api/jobs/${jobId}/result`);
        if (cancelled) return;
        const filename = compositeService.generateFilename(format);
        compositeService.downloadComposite(blob, filename);
        setExportWarning(parseCompositeWarning(headers));

        const completeCb = onExportCompleteRef.current;
        if (completeCb) {
          // eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout -- cleared via timerRef in effect cleanup and unmount
          const timer = setTimeout(() => completeCb(), 500);
          timerRef.current = timer;
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Export download error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setExportError(`Failed to download export: ${errorMessage}`);
      } finally {
        if (!cancelled) {
          setExporting(false);
          setActiveJobId(null);
        }
      }
    };

    downloadResult();
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [jobComplete, jobError, activeJobId, handleExportError]);

  const handleExport = async () => {
    const payloads = buildPayloads();
    if (payloads.length === 0) return;

    setExporting(true);
    setExportError(null);
    setExportWarning(null);
    exportFormatRef.current = exportOptions.format;

    try {
      const { jobId } = await compositeService.exportNChannelCompositeAsync(payloads, {
        ...exportOptions,
        overall: overallAdjustments,
        backgroundNeutralization,
        sharpening: sharpening.amount > 0 ? sharpening : undefined,
        saturation: !isDefaultSaturation(saturation) ? saturation : undefined,
        allowForceDownscale,
      });

      setActiveJobId(jobId);
    } catch (err) {
      console.error('Export error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setExportError(`Failed to start export: ${errorMessage}`);
      setExporting(false);
    }
  };

  const handleOptionChange = (key: keyof ExportOptions, value: string | number) => {
    setExportOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleOverallGammaChange = (value: number) => {
    setActivePreset(null);
    setOverallAdjustments((prev) => ({ ...prev, gamma: value }));
  };

  const handleOverallBlackPointChange = (value: number) => {
    setActivePreset(null);
    setOverallAdjustments((prev) => ({
      ...prev,
      blackPoint: Math.min(value, prev.whitePoint - 0.01),
    }));
  };

  const handleOverallWhitePointChange = (value: number) => {
    setActivePreset(null);
    setOverallAdjustments((prev) => ({
      ...prev,
      whitePoint: Math.max(value, prev.blackPoint + 0.01),
    }));
  };

  const handleOverallStretchChange = (value: StretchMethod) => {
    setActivePreset(null);
    setOverallAdjustments((prev) => ({ ...prev, stretch: value }));
  };

  const handleOverallAsinhAChange = (value: number) => {
    setActivePreset(null);
    setOverallAdjustments((prev) => ({ ...prev, asinhA: value }));
  };

  const handleOverallReset = () => {
    setActivePreset(null);
    setOverallAdjustments({ ...DEFAULT_OVERALL_ADJUSTMENTS });
    setSharpening({ ...DEFAULT_SHARPENING });
    onChannelsChange(
      channels.map((ch) => ({
        ...ch,
        params: { ...DEFAULT_CHANNEL_PARAMS },
      }))
    );
  };

  const handleSharpeningAmountChange = (value: number) => {
    setActivePreset(null);
    setSharpening((prev) => ({ ...prev, amount: value }));
  };

  const handleSharpeningRadiusChange = (value: number) => {
    setActivePreset(null);
    setSharpening((prev) => ({ ...prev, radius: value }));
  };

  const handleSharpeningThresholdChange = (value: number) => {
    setActivePreset(null);
    setSharpening((prev) => ({ ...prev, threshold: value }));
  };

  const handleWeightChange = (channelId: string, weight: number) => {
    setActivePreset(null);
    onChannelsChange(
      channels.map((ch) => (ch.id === channelId ? { ...ch, params: { ...ch.params, weight } } : ch))
    );
  };

  const resolutionPresets = [
    { label: 'HD (1920x1080)', width: 1920, height: 1080 },
    { label: '2K (2048x2048)', width: 2048, height: 2048 },
    { label: '4K (4096x4096)', width: 4096, height: 4096 },
  ];

  // Memory-budget detection for preview/export error rendering.
  const previewMemoryBudget = previewError
    ? compositeService.parseMemoryBudgetError(previewError)
    : null;
  const previewProjectedLabel = previewMemoryBudget?.projectedShape
    ? ` → ${previewMemoryBudget.projectedShape[0]}×${previewMemoryBudget.projectedShape[1]}`
    : '';
  const exportMemoryBudget = exportError
    ? compositeService.parseMemoryBudgetError(exportError)
    : null;
  const exportProjectedLabel = exportMemoryBudget?.projectedShape
    ? ` → ${exportMemoryBudget.projectedShape[0]}×${exportMemoryBudget.projectedShape[1]}`
    : '';

  return (
    <div className="composite-preview-step">
      <div className="preview-section">
        <div className="preview-container large">
          {previewLoading && (
            <div className="preview-loading">
              <div className="spinner" />
              <span>
                {(() => {
                  // Async path: show real stage + elapsed time; sync path keeps
                  // the original generic label.
                  if (!isAuthenticated || !previewJobId) {
                    return 'Generating high-quality preview...';
                  }
                  const stage = previewJobProgress?.stage;
                  const label = (stage && STAGE_LABELS[stage]) || stage || 'Generating composite';
                  return `${label} · ${formatElapsed(previewElapsed)}`;
                })()}
              </span>
              {/* #1471 — only the auth+async path has live engine messages to show */}
              {isAuthenticated && previewJobId && <LogPanel messages={previewJobMessages} />}
            </div>
          )}
          {mosaicRetrying && !previewLoading && (
            <div className="preview-loading">
              <div className="spinner" />
              <span>Building observation mosaic... will retry automatically</span>
            </div>
          )}
          {previewError && !previewLoading && !mosaicRetrying && (
            <div className="preview-error" role="status" aria-live="polite">
              <span>{previewMemoryBudget?.displayMessage ?? previewError}</span>
              <div className="preview-error-actions">
                <button
                  className="btn-base btn-standard btn-retry"
                  onClick={() => generatePreview()}
                >
                  Retry
                </button>
                {previewMemoryBudget?.isMemoryBudget && (
                  <button
                    className="btn-base btn-standard btn-continue"
                    onClick={() => generatePreview(/* forceDownscaleOptIn */ true)}
                  >
                    Continue anyway{previewProjectedLabel}
                  </button>
                )}
              </div>
            </div>
          )}
          {previewUrl && !previewLoading && previewWarning && (
            <CompositeWarningBanner warning={previewWarning} />
          )}
          {previewUrl && !previewLoading && (
            <>
              <img
                src={showBefore && beforePreviewUrl ? beforePreviewUrl : previewUrl}
                alt={showBefore ? 'Before auto-stretch' : 'Final composite preview'}
                className="preview-image"
              />
              {beforePreviewUrl && (
                <button
                  type="button"
                  className={`btn-base before-after-toggle ${showBefore ? 'showing-before' : ''}`}
                  onClick={() => setShowBefore((prev) => !prev)}
                  title={showBefore ? 'Show current (after)' : 'Show previous (before)'}
                >
                  {showBefore ? 'Before' : 'After'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Channel info — drag to swap channels */}
        <div className="channel-summary">
          {channels.map((ch) => {
            const images = getImagesForChannel(ch);
            const color = channelColorToHex(ch.color);
            const displayText =
              images.length === 0
                ? 'Not assigned'
                : images.length <= 2
                  ? images.map((img) => getFilterLabel(img)).join(', ')
                  : `${images.length} filters`;
            const isDragOver = swapDragOver === ch.id;
            return (
              <div
                key={ch.id}
                className={`channel-item${isDragOver ? ' swap-drag-over' : ''}`}
                style={
                  {
                    '--channel-color': color,
                    color: color,
                    background: `${color}18`,
                    borderLeftColor: color,
                  } as React.CSSProperties
                }
                draggable
                onDragStart={(e) => handleSwapDragStart(e, ch.id)}
                onDragOver={(e) => handleSwapDragOver(e, ch.id)}
                onDragLeave={handleSwapDragLeave}
                onDrop={(e) => handleSwapDrop(e, ch.id)}
              >
                <div className="channel-item-header">
                  <span className="channel-label">
                    {ch.color.luminance && (
                      <span className="channel-lum-badge" title="Luminance channel">
                        L
                      </span>
                    )}
                    {ch.label || 'Channel'}
                  </span>
                  <span className="channel-swap-hint">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      opacity="0.4"
                    >
                      <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
                    </svg>
                  </span>
                </div>
                <span className="channel-value">{displayText}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="export-section">
        <h3 className="export-title">Export Options</h3>

        {/* Preset selector */}
        <div className="option-group preset-group">
          <label className="option-label">Preset</label>
          <div className="preset-buttons">
            {COMPOSITE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`btn-base btn-compact preset-btn ${activePreset === preset.id ? 'active' : ''}`}
                onClick={() => handleApplyPreset(preset)}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            {savedPresets.map((preset) => (
              <span key={preset.id} className="saved-preset-wrapper">
                <button
                  type="button"
                  className="btn-base btn-compact preset-btn saved-preset-btn"
                  onClick={() => handleLoadPreset(preset)}
                  title={`Saved ${new Date(preset.createdAt).toLocaleDateString()}`}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="saved-preset-delete"
                  onClick={() => handleDeletePreset(preset.id)}
                  title="Delete saved preset"
                  aria-label={`Delete preset ${preset.name}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <button
              type="button"
              className="btn-base btn-compact preset-btn save-preset-btn"
              onClick={handleSavePreset}
              title="Save current settings as a named preset"
            >
              + Save
            </button>
          </div>
          {activePreset && (
            <span className="preset-hint">
              {COMPOSITE_PRESETS.find((p) => p.id === activePreset)?.description}
            </span>
          )}
          {!activePreset && (
            <span className="preset-hint">
              Custom settings — select a preset for a starting point
            </span>
          )}
        </div>

        {/* Channel Balance — weight sliders */}
        <div className="option-group channel-balance-group">
          <label className="option-label">Channel Balance</label>
          <div className="weight-sliders">
            {channels.map((ch) => {
              const weight = ch.params?.weight ?? 1.0;
              const color = channelColorToHex(ch.color);
              const isLum = !!ch.color.luminance;
              return (
                <div
                  key={ch.id}
                  className="weight-row"
                  style={{ '--weight-color': color } as React.CSSProperties}
                >
                  <span className="weight-dot" />
                  <input
                    type="range"
                    min="0"
                    max={isLum ? '1' : '2'}
                    step="0.05"
                    value={weight}
                    onChange={(e) => handleWeightChange(ch.id, parseFloat(e.target.value))}
                    className="weight-slider"
                  />
                  <span className="weight-value">
                    {isLum ? 'Blend' : `${Math.round(weight * 100)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Background neutralization toggle */}
        <div className="option-group background-neutralization-group">
          <label className="background-neutralization-label">
            <span className="option-label">Background Neutralization</span>
            <button
              type="button"
              role="switch"
              aria-checked={backgroundNeutralization}
              className={`btn-base toggle-switch ${backgroundNeutralization ? 'active' : ''}`}
              onClick={() => {
                setActivePreset(null);
                setBackgroundNeutralization((prev) => !prev);
              }}
            >
              <span className="toggle-thumb" />
            </button>
          </label>
          <span className="background-neutralization-hint">
            Subtract sky background per channel for a neutral black sky
          </span>
        </div>

        <div className="option-group overall-adjustments-group">
          <div className="overall-header">
            <label className="option-label">Overall Levels &amp; Stretch</label>
            <button
              className="btn-base btn-overall-reset"
              type="button"
              onClick={handleOverallReset}
            >
              Reset
            </button>
          </div>

          <div className="option-label-row">
            <label className="option-label">Stretch Function</label>
            <span className="option-value">
              {STRETCH_OPTIONS.find((opt) => opt.value === overallAdjustments.stretch)?.label ??
                'ZScale'}
            </span>
          </div>
          <select
            className="overall-select"
            value={overallAdjustments.stretch}
            onChange={(e) => handleOverallStretchChange(e.target.value as StretchMethod)}
          >
            {STRETCH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="overall-hint">
            {STRETCH_OPTIONS.find((opt) => opt.value === overallAdjustments.stretch)?.description}
          </span>

          <div className="option-label-row">
            <label className="option-label">Gamma</label>
            <span className="option-value">{overallAdjustments.gamma.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.05"
            value={overallAdjustments.gamma}
            onChange={(e) => handleOverallGammaChange(parseFloat(e.target.value))}
            className="quality-slider"
          />
          <div className="slider-labels">
            <span>Darker</span>
            <span>Brighter</span>
          </div>

          <div className="option-label-row">
            <label className="option-label">Black Point</label>
            <span className="option-value">
              {(overallAdjustments.blackPoint * 100).toFixed(1)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="0.99"
            step="0.001"
            value={overallAdjustments.blackPoint}
            onChange={(e) => handleOverallBlackPointChange(parseFloat(e.target.value))}
            className="quality-slider"
          />

          <div className="option-label-row">
            <label className="option-label">White Point</label>
            <span className="option-value">
              {(overallAdjustments.whitePoint * 100).toFixed(1)}%
            </span>
          </div>
          <input
            type="range"
            min="0.01"
            max="1.0"
            step="0.001"
            value={overallAdjustments.whitePoint}
            onChange={(e) => handleOverallWhitePointChange(parseFloat(e.target.value))}
            className="quality-slider"
          />

          {overallAdjustments.stretch === 'asinh' && (
            <>
              <div className="option-label-row">
                <label className="option-label">Asinh Softening</label>
                <span className="option-value">{overallAdjustments.asinhA.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.001"
                max="1.0"
                step="0.001"
                value={overallAdjustments.asinhA}
                onChange={(e) => handleOverallAsinhAChange(parseFloat(e.target.value))}
                className="quality-slider"
              />
              <div className="slider-labels">
                <span>More compression</span>
                <span>More linear</span>
              </div>
            </>
          )}

          <div className="sharpening-section">
            <div className="option-label-row">
              <label className="option-label">Sharpening (Unsharp Mask)</label>
              <span className="option-value">{sharpening.amount.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min="0"
              max="3.0"
              step="0.05"
              value={sharpening.amount}
              onChange={(e) => handleSharpeningAmountChange(parseFloat(e.target.value))}
              className="quality-slider"
              aria-label="Sharpening amount"
            />
            <div className="slider-labels">
              <span>Off</span>
              <span>Aggressive</span>
            </div>

            {sharpening.amount > 0 && (
              <>
                <div className="option-label-row">
                  <label className="option-label">Radius</label>
                  <span className="option-value">{sharpening.radius.toFixed(1)} px</span>
                </div>
                {/* min/max match SharpeningConfig.radius Range(0.5, 10.0) on backend */}
                <input
                  type="range"
                  min="0.5"
                  max="10.0"
                  step="0.1"
                  value={sharpening.radius}
                  onChange={(e) => handleSharpeningRadiusChange(parseFloat(e.target.value))}
                  className="quality-slider"
                  aria-label="Sharpening radius"
                />
                <div className="slider-labels">
                  <span>Fine detail</span>
                  <span>Broad structure</span>
                </div>

                <div className="option-label-row">
                  <label className="option-label">Threshold</label>
                  <span className="option-value">{(sharpening.threshold * 100).toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.005"
                  value={sharpening.threshold}
                  onChange={(e) => handleSharpeningThresholdChange(parseFloat(e.target.value))}
                  className="quality-slider"
                  aria-label="Sharpening threshold"
                />
                <div className="slider-labels">
                  <span>Sharpen everything</span>
                  <span>Skip smooth areas</span>
                </div>
              </>
            )}
          </div>

          <div className="saturation-section">
            <div className="option-label-row">
              <label className="option-label">Saturation</label>
              <span className="option-value">{saturation.saturation.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min="0"
              max="2.0"
              step="0.05"
              value={saturation.saturation}
              onChange={(e) => {
                setActivePreset(null);
                setSaturation((prev) => ({ ...prev, saturation: parseFloat(e.target.value) }));
              }}
              className="quality-slider"
              aria-label="Saturation"
            />
            <div className="slider-labels">
              <span>Grayscale</span>
              <span>Vivid</span>
            </div>

            <div className="option-label-row">
              <label className="option-label">Vibrancy</label>
              <span className="option-value">{saturation.vibrancy.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.05"
              value={saturation.vibrancy}
              onChange={(e) => {
                setActivePreset(null);
                setSaturation((prev) => ({ ...prev, vibrancy: parseFloat(e.target.value) }));
              }}
              className="quality-slider"
              aria-label="Vibrancy"
            />
            <div className="slider-labels">
              <span>Off</span>
              <span>Boost muted colors</span>
            </div>

            <div className="option-label-row">
              <label className="option-label">Hue Rotation</label>
              <span className="option-value">{saturation.hueRotation.toFixed(0)}°</span>
            </div>
            <input
              type="range"
              min="-30"
              max="30"
              step="1"
              value={saturation.hueRotation}
              onChange={(e) => {
                setActivePreset(null);
                setSaturation((prev) => ({ ...prev, hueRotation: parseFloat(e.target.value) }));
              }}
              className="quality-slider"
              aria-label="Hue rotation"
            />
            <div className="slider-labels">
              <span>−30° Cooler</span>
              <span>+30° Warmer</span>
            </div>
          </div>
        </div>

        {/* Per-channel adjustments */}
        <div className="option-group per-channel-group">
          <div className="per-channel-header">
            <button
              className={`btn-base per-channel-toggle ${perChannelExpanded ? 'expanded' : ''}`}
              onClick={() => setPerChannelExpanded(!perChannelExpanded)}
              type="button"
            >
              <span className="per-channel-toggle-label">Per-Channel Adjustments</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`per-channel-chevron ${perChannelExpanded ? 'expanded' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-base btn-compact auto-all-btn"
              onClick={handleAutoAll}
              disabled={analyzing}
              title="Auto-detect optimal stretch for all channels"
            >
              {analyzing ? (
                <span className="analyzing-spinner" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6a5.87 5.87 0 0 1-2.8-.7l-1.46 1.46A7.93 7.93 0 0 0 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46A7.93 7.93 0 0 0 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z" />
                </svg>
              )}
              Auto All
            </button>
          </div>
          {perChannelExpanded && (
            <div className="per-channel-controls">
              {channels.map((ch) => {
                const images = getImagesForChannel(ch);
                if (images.length === 0) return null;
                const color = channelColorToHex(ch.color);
                const analysis = ch.analysis;
                const histData: HistogramData | null = analysis
                  ? {
                      counts: analysis.histogram.counts,
                      bin_centers: analysis.histogram.binCenters,
                      bin_edges: analysis.histogram.binEdges,
                      n_bins: analysis.histogram.nBins,
                    }
                  : null;
                const histStats: HistogramStats | null = analysis
                  ? {
                      min: analysis.stats.min,
                      max: analysis.stats.max,
                      mean: analysis.stats.mean,
                      std: analysis.stats.std,
                    }
                  : null;
                return (
                  <div
                    key={ch.id}
                    className="per-channel-item"
                    style={{ '--channel-color': color } as React.CSSProperties}
                  >
                    <div className="per-channel-label">
                      <span className="per-channel-dot" />
                      <span>{ch.label || 'Channel'}</span>
                      <span className="per-channel-filter">
                        {images.map((img) => getFilterLabel(img)).join(', ')}
                      </span>
                      <button
                        type="button"
                        className="btn-base btn-compact auto-btn"
                        onClick={() => handleAutoChannel(ch.id)}
                        disabled={analyzing}
                        title="Auto-detect optimal stretch for this channel"
                      >
                        {analyzing ? <span className="analyzing-spinner" /> : null}
                        Auto
                      </button>
                    </div>
                    <StretchControls
                      params={ch.params || DEFAULT_CHANNEL_PARAMS}
                      onChange={(params) => handleChannelParamChange(ch.id, params)}
                      collapsed={channelCollapsed[ch.id] ?? true}
                      onToggleCollapse={() => toggleChannelCollapsed(ch.id)}
                    />
                    {analysis && (
                      <>
                        <HistogramPanel
                          histogram={histData}
                          stats={histStats}
                          blackPoint={ch.params.blackPoint}
                          whitePoint={ch.params.whitePoint}
                          onBlackPointChange={(v) =>
                            handleChannelParamChange(ch.id, { ...ch.params, blackPoint: v })
                          }
                          onWhitePointChange={(v) =>
                            handleChannelParamChange(ch.id, { ...ch.params, whitePoint: v })
                          }
                          collapsed={histogramCollapsed[ch.id] ?? true}
                          onToggleCollapse={() =>
                            setHistogramCollapsed((prev) => ({
                              ...prev,
                              [ch.id]: !(prev[ch.id] ?? true),
                            }))
                          }
                          title={`${ch.label || 'Channel'} Histogram`}
                          barColor={color}
                        />
                        <div
                          className={`analysis-card ${analysisCardCollapsed[ch.id] !== false ? 'collapsed' : ''}`}
                        >
                          <button
                            type="button"
                            className="analysis-card-toggle"
                            onClick={() =>
                              setAnalysisCardCollapsed((prev) => ({
                                ...prev,
                                [ch.id]: prev[ch.id] === false,
                              }))
                            }
                          >
                            <span className="analysis-card-title">
                              Auto-Stretch Details
                              {analysis.meta.hdrDetected && (
                                <span
                                  className="analysis-badge-hdr"
                                  title="High dynamic range detected"
                                >
                                  HDR
                                </span>
                              )}
                              {analysis.meta.instrumentAdjusted && (
                                <span
                                  className="analysis-badge-instrument"
                                  title="Instrument-specific adjustment applied"
                                >
                                  MIRI
                                </span>
                              )}
                            </span>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                          {analysisCardCollapsed[ch.id] === false && (
                            <div className="analysis-card-body">
                              <div className="analysis-row">
                                <span>Dynamic Range</span>
                                <span>{analysis.meta.dynamicRange.toFixed(0)}:1</span>
                              </div>
                              <div className="analysis-row">
                                <span>SNR</span>
                                <span>{analysis.meta.snr.toFixed(1)}</span>
                              </div>
                              <div className="analysis-row">
                                <span>Noise Floor</span>
                                <span>{analysis.meta.noise.toExponential(2)}</span>
                              </div>
                              <div className="analysis-row">
                                <span>Valid Pixels</span>
                                <span>{analysis.meta.validPixels.toLocaleString()}</span>
                              </div>
                              <div className="analysis-row">
                                <span>Coverage</span>
                                <span>
                                  {((1 - analysis.meta.zeroCoverageFrac) * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div className="analysis-row">
                                <span>Curve</span>
                                <span>{analysis.meta.curveReason.replace(/_/g, ' ')}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Format selection */}
        <div className="option-group">
          <label className="option-label">Format</label>
          <div className="format-buttons">
            <button
              className={`btn-base format-btn ${exportOptions.format === 'png' ? 'active' : ''}`}
              onClick={() => handleOptionChange('format', 'png')}
              type="button"
            >
              PNG
              <span className="format-hint">Lossless</span>
            </button>
            <button
              className={`btn-base format-btn ${exportOptions.format === 'jpeg' ? 'active' : ''}`}
              onClick={() => handleOptionChange('format', 'jpeg')}
              type="button"
            >
              JPEG
              <span className="format-hint">Smaller file</span>
            </button>
          </div>
        </div>

        {/* Quality (JPEG only) */}
        {exportOptions.format === 'jpeg' && (
          <div className="option-group">
            <div className="option-label-row">
              <label className="option-label">Quality</label>
              <span className="option-value">{exportOptions.quality}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="100"
              step="1"
              value={exportOptions.quality}
              onChange={(e) => handleOptionChange('quality', parseInt(e.target.value))}
              className="quality-slider"
            />
            <div className="slider-labels">
              <span>Smaller</span>
              <span>Higher Quality</span>
            </div>
          </div>
        )}

        {/* Resolution presets */}
        <div className="option-group">
          <label className="option-label">Resolution</label>
          <div className="resolution-presets">
            {resolutionPresets.slice(0, 3).map((preset) => (
              <button
                key={preset.label}
                className={`btn-base btn-compact preset-btn ${
                  exportOptions.width === preset.width && exportOptions.height === preset.height
                    ? 'active'
                    : ''
                }`}
                onClick={() => {
                  handleOptionChange('width', preset.width);
                  handleOptionChange('height', preset.height);
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom resolution inputs */}
        <div className="option-group">
          <label className="option-label">Custom Size</label>
          <div className="dimension-inputs">
            <div className="dimension-field">
              <label>Width</label>
              <input
                type="number"
                min="100"
                max="4096"
                value={exportOptions.width}
                onChange={(e) => handleOptionChange('width', parseInt(e.target.value) || 100)}
              />
              <span className="dimension-unit">px</span>
            </div>
            <span className="dimension-separator">&times;</span>
            <div className="dimension-field">
              <label>Height</label>
              <input
                type="number"
                min="100"
                max="4096"
                value={exportOptions.height}
                onChange={(e) => handleOptionChange('height', parseInt(e.target.value) || 100)}
              />
              <span className="dimension-unit">px</span>
            </div>
          </div>
        </div>

        {exportError && (
          <div className="export-error" role="status" aria-live="polite">
            <span>{exportMemoryBudget?.displayMessage ?? exportError}</span>
            {exportMemoryBudget?.isMemoryBudget && (
              <button
                type="button"
                className="btn-base btn-standard btn-continue"
                onClick={() => {
                  // Sticky opt-in for the export path: subsequent retries
                  // and slider-driven previews honor the same override.
                  setAllowForceDownscale(true);
                  setExportError(null);
                  handleExport();
                }}
              >
                Continue anyway{exportProjectedLabel}
              </button>
            )}
          </div>
        )}

        {exportWarning && !exporting && <CompositeWarningBanner warning={exportWarning} />}

        {/* Export button — fills as progress bar during export */}
        <button
          className={`btn-base btn-export${exporting ? ' exporting' : ''}`}
          style={
            exporting ? ({ '--progress': `${displayProgress}%` } as React.CSSProperties) : undefined
          }
          onClick={handleExport}
          disabled={exporting || !previewUrl}
          type="button"
          role={exporting ? 'progressbar' : undefined}
          aria-valuenow={exporting ? displayProgress : undefined}
          aria-valuemin={exporting ? 0 : undefined}
          aria-valuemax={exporting ? 100 : undefined}
        >
          <span className="btn-export-content">
            {exporting ? (
              <span>
                {jobProgress?.stage === 'mosaic'
                  ? jobProgress.message
                  : `Exporting... ${displayProgress}%`}
              </span>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
                <span>Export &amp; Download {exportOptions.format.toUpperCase()}</span>
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  );
};

export default CompositePreviewStep;
