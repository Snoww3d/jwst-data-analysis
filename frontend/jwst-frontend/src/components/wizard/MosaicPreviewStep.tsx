import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useImperativeHandle,
  type Ref,
} from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  MosaicFileConfig,
  MosaicRequest,
  FootprintResponse,
  SavedMosaicResponse,
  DEFAULT_MOSAIC_FILE_PARAMS,
  COMBINE_METHODS,
  MOSAIC_COLORMAPS,
  MOSAIC_STRETCH_OPTIONS,
  MosaicStretchMethod,
} from '../../types/MosaicTypes';
import { ApiError } from '../../services/ApiError';
import * as mosaicService from '../../services/mosaicService';
import { useJobProgress } from '../../hooks/useJobProgress';
import { API_BASE_URL } from '../../config/api';
import FootprintPreview from './FootprintPreview';
import './MosaicPreviewStep.css';

const OUTPUT_DIMENSION_MIN = 1;
const OUTPUT_DIMENSION_MAX = 8000;

const RESOLUTION_PRESETS: ReadonlyArray<{ label: string; width?: number; height?: number }> = [
  { label: 'Native', width: undefined, height: undefined },
  { label: 'HD', width: 1920, height: 1080 },
  { label: '2K', width: 2048, height: 2048 },
  { label: '4K', width: 4096, height: 4096 },
];

export interface MosaicPreviewStepHandle {
  generate: () => void;
}

export interface MosaicFooterState {
  generating: boolean;
  hasResult: boolean;
  canGenerate: boolean;
}

interface MosaicPreviewStepProps {
  selectedImages: JwstDataModel[];
  selectedIds: string[];
  footprintData: FootprintResponse | null;
  footprintLoading: boolean;
  footprintError: string | null;
  onRetryFootprints: () => void;
  onMosaicSaved?: () => void;
  onFooterStateChange?: (state: MosaicFooterState) => void;
  ref?: Ref<MosaicPreviewStepHandle>;
}

/**
 * Step 2: Preview & Export — footprint/mosaic preview (left) + settings sidebar (right)
 */
export const MosaicPreviewStep = ({
  selectedImages,
  selectedIds,
  footprintData,
  footprintLoading,
  footprintError,
  onRetryFootprints,
  onMosaicSaved,
  onFooterStateChange,
  ref,
}: MosaicPreviewStepProps) => {
  // Mosaic settings
  const [combineMethod, setCombineMethod] = useState<MosaicRequest['combineMethod']>('mean');
  const [cmap, setCmap] = useState<MosaicRequest['cmap']>('grayscale');
  const [stretch, setStretch] = useState<MosaicStretchMethod>('asinh');

  // Export options
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(95);
  const [outputWidth, setOutputWidth] = useState('');
  const [outputHeight, setOutputHeight] = useState('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // FITS save state (async via job queue)
  const [saveJobId, setSaveJobId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMosaic, setSavedMosaic] = useState<SavedMosaicResponse | null>(null);

  // Export state (async via job queue)
  const [exporting, setExporting] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [simulatedExportProgress, setSimulatedExportProgress] = useState(0);
  const exportFormatRef = useRef<'png' | 'jpeg'>('png');

  // Sticky flag: once a mosaic has been generated, footer stays in "has result" mode
  // (avoids footer flash during re-generation when resultUrl is temporarily null)
  const [hasGenerated, setHasGenerated] = useState(false);

  const generateAbortRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  // Job progress hooks for async operations
  const {
    progress: exportJobProgress,
    isComplete: exportJobComplete,
    error: exportJobError,
  } = useJobProgress(exportJobId, undefined, true);

  const {
    progress: saveJobProgress,
    isComplete: saveJobComplete,
    error: saveJobError,
  } = useJobProgress(saveJobId, undefined, true);

  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);

  // Cleanup object URLs and abort controllers on unmount
  useEffect(
    () => () => {
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
      }
      generateAbortRef.current?.abort();
    },
    []
  );

  // Export progress: simulated smooth interpolation between real SignalR updates
  const realExportProgress = exportJobProgress?.progress ?? 0;

  useEffect(() => {
    if (!exporting) {
      setSimulatedExportProgress(0);
      return;
    }
    if (exportJobComplete) {
      setSimulatedExportProgress(100);
      return;
    }
    if (realExportProgress > simulatedExportProgress) {
      setSimulatedExportProgress(realExportProgress);
    }
  }, [exporting, exportJobComplete, realExportProgress, simulatedExportProgress]);

  useEffect(() => {
    if (!exporting || exportJobComplete) return;
    const timer = setInterval(() => {
      setSimulatedExportProgress((prev) => {
        const target = 90;
        const remaining = target - prev;
        if (remaining <= 0.5) return prev;
        return prev + remaining * 0.03;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [exporting, exportJobComplete]);

  const displayExportProgress = Math.round(simulatedExportProgress);

  // Save progress
  const savingFits = saveJobId !== null && !saveJobComplete;
  const realSaveProgress = saveJobProgress?.progress ?? 0;
  const displaySaveProgress = saveJobComplete ? 100 : Math.round(realSaveProgress);

  // Dimension validation
  const normalizedOutputWidth = outputWidth.trim();
  const normalizedOutputHeight = outputHeight.trim();
  const outputWidthValue = normalizedOutputWidth === '' ? null : Number(normalizedOutputWidth);
  const outputHeightValue = normalizedOutputHeight === '' ? null : Number(normalizedOutputHeight);
  const isOutputWidthValid =
    outputWidthValue === null ||
    (Number.isInteger(outputWidthValue) &&
      outputWidthValue >= OUTPUT_DIMENSION_MIN &&
      outputWidthValue <= OUTPUT_DIMENSION_MAX);
  const isOutputHeightValid =
    outputHeightValue === null ||
    (Number.isInteger(outputHeightValue) &&
      outputHeightValue >= OUTPUT_DIMENSION_MIN &&
      outputHeightValue <= OUTPUT_DIMENSION_MAX);
  const dimensionError = !isOutputWidthValid
    ? `Width must be an integer from ${OUTPUT_DIMENSION_MIN} to ${OUTPUT_DIMENSION_MAX}.`
    : !isOutputHeightValid
      ? `Height must be an integer from ${OUTPUT_DIMENSION_MIN} to ${OUTPUT_DIMENSION_MAX}.`
      : null;
  const resolvedOutputWidth = isOutputWidthValid ? outputWidthValue : null;
  const resolvedOutputHeight = isOutputHeightValid ? outputHeightValue : null;
  const outputDimensionLabel =
    resolvedOutputWidth !== null && resolvedOutputHeight !== null
      ? `${resolvedOutputWidth}x${resolvedOutputHeight}`
      : resolvedOutputWidth !== null
        ? `${resolvedOutputWidth}xauto`
        : resolvedOutputHeight !== null
          ? `autox${resolvedOutputHeight}`
          : 'native';

  const applyResolutionPreset = useCallback((width?: number, height?: number) => {
    setOutputWidth(width?.toString() ?? '');
    setOutputHeight(height?.toString() ?? '');
  }, []);

  const isPresetActive = useCallback(
    (width?: number, height?: number) =>
      outputWidth === (width?.toString() ?? '') && outputHeight === (height?.toString() ?? ''),
    [outputHeight, outputWidth]
  );

  // Build file configs from selected IDs
  const buildFileConfigs = useCallback(
    (): MosaicFileConfig[] =>
      selectedIds.map((id) => ({
        dataId: id,
        ...DEFAULT_MOSAIC_FILE_PARAMS,
        stretch,
      })),
    [selectedIds, stretch]
  );

  // Generate mosaic
  const handleGenerate = useCallback(async () => {
    if (selectedIds.length < 2) return;
    if (dimensionError) {
      setGenerateError(dimensionError);
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    setSaveError(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    const request: MosaicRequest = {
      files: buildFileConfigs(),
      outputFormat,
      quality,
      width: resolvedOutputWidth ?? undefined,
      height: resolvedOutputHeight ?? undefined,
      combineMethod,
      cmap,
    };

    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;

    try {
      const blob = await mosaicService.generateMosaic(request, controller.signal);
      setResultUrl(URL.createObjectURL(blob));
      setHasGenerated(true);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      let msg = 'Mosaic generation failed';
      if (ApiError.isApiError(err)) {
        msg = err.status === 413 ? err.message : err.details || err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setGenerateError(msg);
    } finally {
      setGenerating(false);
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
      }
    }
  }, [
    cmap,
    combineMethod,
    dimensionError,
    resolvedOutputHeight,
    outputFormat,
    resolvedOutputWidth,
    quality,
    resultUrl,
    selectedIds,
    buildFileConfigs,
  ]);

  // Save native FITS (async via job queue)
  const handleSaveFits = useCallback(async () => {
    if (selectedIds.length < 2) return;

    setSaveError(null);
    setSavedMosaic(null);

    const request: MosaicRequest = {
      files: buildFileConfigs(),
      outputFormat: 'fits',
      quality: 95,
      combineMethod,
      cmap,
    };

    try {
      const { jobId } = await mosaicService.saveMosaicAsync(request);
      setSaveJobId(jobId);
    } catch (err) {
      let msg = 'Failed to start FITS save';
      if (ApiError.isApiError(err)) {
        msg = err.details || err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setSaveError(msg);
    }
  }, [cmap, combineMethod, selectedIds, buildFileConfigs]);

  // Handle save completion via SignalR
  useEffect(() => {
    if (!saveJobComplete || !saveJobId) return;

    if (saveJobError) {
      setSaveError(saveJobError);
      setSaveJobId(null);
      return;
    }

    // Extract resultDataId from the completed job progress
    const dataId = saveJobProgress?.resultDataId;
    if (!dataId) {
      setSaveError('Save completed but result data ID is missing');
      setSaveJobId(null);
      return;
    }

    setSavedMosaic({
      dataId,
      fileName: 'mosaic.fits',
      fileSize: 0,
      fileFormat: 'fits',
      processingLevel: 'L3',
      derivedFrom: selectedIds,
    });
    onMosaicSaved?.();
    setSaveJobId(null);
  }, [saveJobComplete, saveJobError, saveJobId, saveJobProgress, selectedIds, onMosaicSaved]);

  // Export & Download (async via job queue, matching composite pattern)
  const handleExport = useCallback(async () => {
    if (selectedIds.length < 2) return;
    if (dimensionError) {
      setExportError(dimensionError);
      return;
    }

    setExporting(true);
    setExportError(null);
    exportFormatRef.current = outputFormat;

    const request: MosaicRequest = {
      files: buildFileConfigs(),
      outputFormat,
      quality,
      width: resolvedOutputWidth ?? undefined,
      height: resolvedOutputHeight ?? undefined,
      combineMethod,
      cmap,
    };

    try {
      const { jobId } = await mosaicService.exportMosaicAsync(request);
      setExportJobId(jobId);
    } catch (err) {
      let msg = 'Failed to start export';
      if (ApiError.isApiError(err)) {
        msg = err.details || err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setExportError(msg);
      setExporting(false);
    }
  }, [
    cmap,
    combineMethod,
    dimensionError,
    resolvedOutputHeight,
    outputFormat,
    resolvedOutputWidth,
    quality,
    selectedIds,
    buildFileConfigs,
  ]);

  // Auto-download on export completion (matching composite pattern)
  useEffect(() => {
    if (!exportJobComplete || !exportJobId) return;

    if (exportJobError) {
      setExportError(exportJobError);
      setExporting(false);
      setExportJobId(null);
      return;
    }

    let cancelled = false;
    const jobId = exportJobId;
    const format = exportFormatRef.current;

    const downloadResult = async () => {
      try {
        const token = mosaicService.getMosaicToken();
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, { headers });
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(`Download failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        if (cancelled) return;
        const filename = mosaicService.generateMosaicFilename(format);
        mosaicService.downloadMosaic(blob, filename);
      } catch (err) {
        if (cancelled) return;
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setExportError(`Failed to download export: ${errorMessage}`);
      } finally {
        if (!cancelled) {
          setExporting(false);
          setExportJobId(null);
        }
      }
    };

    downloadResult();
    return () => {
      cancelled = true;
    };
  }, [exportJobComplete, exportJobError, exportJobId]);

  // Expose generate to parent for footer button
  useImperativeHandle(
    ref,
    () => ({
      generate: handleGenerate,
    }),
    [handleGenerate]
  );

  // Report footer state to parent
  useEffect(() => {
    onFooterStateChange?.({
      generating,
      hasResult: hasGenerated,
      canGenerate: !generating && !savingFits && !exporting && !dimensionError,
    });
  }, [generating, savingFits, exporting, hasGenerated, dimensionError, onFooterStateChange]);

  // Summary of selected files
  const selectedSummary = useMemo(() => {
    return `${selectedImages.length} files | ${combineMethod} | ${cmap} | ${outputDimensionLabel}`;
  }, [selectedImages.length, combineMethod, cmap, outputDimensionLabel]);

  return (
    <div className="mosaic-preview-step">
      {/* Left: Preview area */}
      <div className="mosaic-preview-section">
        {/* Before generation: show footprint */}
        {!resultUrl && (
          <>
            {footprintLoading && (
              <div className="mosaic-preview-loading">
                <div className="mosaic-spinner" />
                <span>Loading footprints...</span>
              </div>
            )}
            {footprintError && !footprintLoading && (
              <div className="mosaic-preview-error">
                <p>{footprintError}</p>
                <button onClick={onRetryFootprints} className="mosaic-btn-retry" type="button">
                  Retry
                </button>
              </div>
            )}
            {!footprintLoading && !footprintError && !footprintData && (
              <div className="mosaic-preview-placeholder">
                <p>No footprint data to display yet.</p>
              </div>
            )}
            {footprintData && !footprintLoading && (
              <FootprintPreview footprintData={footprintData} selectedImages={selectedImages} />
            )}
          </>
        )}

        {/* After generation: show mosaic result */}
        {resultUrl && (
          <div className="mosaic-result">
            <div className="mosaic-result-image-container">
              <img src={resultUrl} alt="Generated WCS mosaic" className="mosaic-result-image" />
            </div>
            <div className="mosaic-result-actions">
              <button
                className={`btn-export${exporting ? ' exporting' : ''}`}
                style={
                  exporting
                    ? ({ '--progress': `${displayExportProgress}%` } as React.CSSProperties)
                    : undefined
                }
                onClick={handleExport}
                disabled={exporting || savingFits}
                type="button"
                role={exporting ? 'progressbar' : undefined}
                aria-valuenow={exporting ? displayExportProgress : undefined}
                aria-valuemin={exporting ? 0 : undefined}
                aria-valuemax={exporting ? 100 : undefined}
              >
                <span className="btn-export-content">
                  {exporting ? (
                    <span>Exporting... {displayExportProgress}%</span>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                      </svg>
                      <span>Export &amp; Download {outputFormat.toUpperCase()}</span>
                    </>
                  )}
                </span>
              </button>
              <button
                className={`mosaic-btn-save-fits${savingFits ? ' saving' : ''}`}
                style={
                  savingFits
                    ? ({ '--progress': `${displaySaveProgress}%` } as React.CSSProperties)
                    : undefined
                }
                onClick={handleSaveFits}
                disabled={savingFits || exporting || generating}
                type="button"
                role={savingFits ? 'progressbar' : undefined}
                aria-valuenow={savingFits ? displaySaveProgress : undefined}
                aria-valuemin={savingFits ? 0 : undefined}
                aria-valuemax={savingFits ? 100 : undefined}
              >
                {savingFits ? (
                  <>
                    <div className="mosaic-spinner small" />
                    Saving FITS... {displaySaveProgress}%
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                    </svg>
                    Save FITS to Library
                  </>
                )}
              </button>
              <span className="mosaic-result-info">{selectedSummary}</span>
            </div>
            {exportError && (
              <div className="mosaic-error-msg">
                <p>{exportError}</p>
              </div>
            )}
            {saveError && (
              <div className="mosaic-error-msg">
                <p>{saveError}</p>
              </div>
            )}
            {savedMosaic && (
              <div className="mosaic-saved-info">
                Saved {savedMosaic.fileName} ({(savedMosaic.fileSize / 1024 / 1024).toFixed(1)} MB)
                | dataId: {savedMosaic.dataId}. Close wizard to refresh library.
              </div>
            )}
          </div>
        )}

        {/* Generation loading overlay */}
        {generating && (
          <div className="mosaic-generating-overlay">
            <div className="mosaic-spinner" />
            <span>Generating Mosaic...</span>
          </div>
        )}
      </div>

      {/* Right: Settings sidebar */}
      <div className="mosaic-settings-sidebar">
        <h3 className="mosaic-sidebar-title">Mosaic Settings</h3>

        <div className="mosaic-setting-group">
          <label htmlFor="mosaic-combine">Combine Method</label>
          <select
            id="mosaic-combine"
            value={combineMethod}
            onChange={(e) => setCombineMethod(e.target.value as MosaicRequest['combineMethod'])}
          >
            {COMBINE_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} - {m.description}
              </option>
            ))}
          </select>
        </div>

        <div className="mosaic-setting-group">
          <label htmlFor="mosaic-cmap">Colormap</label>
          <select
            id="mosaic-cmap"
            value={cmap}
            onChange={(e) => setCmap(e.target.value as MosaicRequest['cmap'])}
          >
            {MOSAIC_COLORMAPS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="mosaic-setting-group">
          <label htmlFor="mosaic-stretch">Stretch</label>
          <select
            id="mosaic-stretch"
            value={stretch}
            onChange={(e) => setStretch(e.target.value as MosaicStretchMethod)}
          >
            {MOSAIC_STRETCH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} - {option.description}
              </option>
            ))}
          </select>
        </div>

        <div className="mosaic-sidebar-divider" />

        <h3 className="mosaic-sidebar-title">Export Options</h3>

        <div className="mosaic-setting-group">
          <label htmlFor="mosaic-format">Format</label>
          <select
            id="mosaic-format"
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value as 'png' | 'jpeg')}
          >
            <option value="png">PNG (lossless)</option>
            <option value="jpeg">JPEG (smaller file)</option>
          </select>
        </div>

        {outputFormat === 'jpeg' && (
          <div className="mosaic-setting-group">
            <label htmlFor="mosaic-quality">Quality: {quality}</label>
            <input
              id="mosaic-quality"
              type="range"
              min="50"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </div>
        )}

        <div className="mosaic-setting-group">
          <label>Output Size</label>
          <div className="mosaic-resolution-presets">
            {RESOLUTION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`mosaic-resolution-preset ${isPresetActive(preset.width, preset.height) ? 'active' : ''}`}
                onClick={() => applyResolutionPreset(preset.width, preset.height)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mosaic-dimension-inputs">
            <div className="mosaic-dimension-field">
              <label htmlFor="mosaic-width">Width</label>
              <input
                id="mosaic-width"
                type="number"
                min={OUTPUT_DIMENSION_MIN}
                max={OUTPUT_DIMENSION_MAX}
                placeholder="native"
                value={outputWidth}
                onChange={(e) => setOutputWidth(e.target.value)}
              />
            </div>
            <span className="mosaic-dimension-separator">x</span>
            <div className="mosaic-dimension-field">
              <label htmlFor="mosaic-height">Height</label>
              <input
                id="mosaic-height"
                type="number"
                min={OUTPUT_DIMENSION_MIN}
                max={OUTPUT_DIMENSION_MAX}
                placeholder="native"
                value={outputHeight}
                onChange={(e) => setOutputHeight(e.target.value)}
              />
            </div>
          </div>
          <p className="mosaic-dimension-hint">
            Leave blank for native resolution. Range: {OUTPUT_DIMENSION_MIN} to{' '}
            {OUTPUT_DIMENSION_MAX}px.
          </p>
          {dimensionError && <p className="mosaic-dimension-error">{dimensionError}</p>}
        </div>

        {/* Generation error shown in sidebar near settings */}
        {generateError && (
          <div className="mosaic-error-msg">
            <p>{generateError}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MosaicPreviewStep;
