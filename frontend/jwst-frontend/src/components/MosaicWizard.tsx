import React, { useState, useCallback, useEffect, useRef, useMemo, useId } from 'react';
import {
  JwstDataModel,
  ProcessingLevelColors,
  ProcessingLevelLabels,
} from '../types/JwstDataTypes';
import {
  MosaicFileConfig,
  MosaicRequest,
  FootprintResponse,
  MosaicWizardStep,
  DEFAULT_MOSAIC_FILE_PARAMS,
  COMBINE_METHODS,
  MOSAIC_COLORMAPS,
  MOSAIC_STRETCH_OPTIONS,
  MosaicStretchMethod,
} from '../types/MosaicTypes';
import * as mosaicService from '../services/mosaicService';
import './MosaicWizard.css';

interface MosaicWizardProps {
  allImages: JwstDataModel[];
  onClose: () => void;
}

const WIZARD_STEPS = [
  { number: 1, label: 'Select Files' },
  { number: 2, label: 'Configure' },
  { number: 3, label: 'Generate' },
];

// Processing level sort order: raw first, then rate, calibrated, combined
const LEVEL_SORT_ORDER: Record<string, number> = {
  L1: 0,
  L2a: 1,
  L2b: 2,
  L3: 3,
  unknown: 4,
};

const OUTPUT_DIMENSION_MIN = 1;
const OUTPUT_DIMENSION_MAX = 8000;

const RESOLUTION_PRESETS: ReadonlyArray<{ label: string; width?: number; height?: number }> = [
  { label: 'Native', width: undefined, height: undefined },
  { label: 'HD', width: 1920, height: 1080 },
  { label: '2K', width: 2048, height: 2048 },
  { label: '4K', width: 4096, height: 4096 },
];

/**
 * WCS Mosaic Creator wizard modal
 * Supports: multi-file selection (2+), footprint preview, mosaic generation & export
 */
export const MosaicWizard: React.FC<MosaicWizardProps> = ({ allImages, onClose }) => {
  // Step state
  const [currentStep, setCurrentStep] = useState<MosaicWizardStep>(1);

  // Step 1: File selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  // Step 2: Configuration + footprint
  const [combineMethod, setCombineMethod] = useState<MosaicRequest['combineMethod']>('mean');
  const [cmap, setCmap] = useState<MosaicRequest['cmap']>('inferno');
  const [stretch, setStretch] = useState<MosaicStretchMethod>('asinh');
  const [footprintData, setFootprintData] = useState<FootprintResponse | null>(null);
  const [footprintLoading, setFootprintLoading] = useState(false);
  const [footprintError, setFootprintError] = useState<string | null>(null);

  // Step 3: Generate + export
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(95);
  const [outputWidth, setOutputWidth] = useState('');
  const [outputHeight, setOutputHeight] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const footprintAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);

  // Close on Escape.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Cleanup in-flight requests/object URLs on unmount.
  useEffect(
    () => () => {
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
      }
      footprintAbortRef.current?.abort();
      generateAbortRef.current?.abort();
    },
    []
  );

  // Filter and sort images by processing level (lineage order)
  const filteredImages = useMemo(
    () =>
      allImages
        .filter((img) => {
          if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
              img.fileName.toLowerCase().includes(term) ||
              img.imageInfo?.targetName?.toLowerCase().includes(term) ||
              img.imageInfo?.filter?.toLowerCase().includes(term) ||
              img.imageInfo?.instrument?.toLowerCase().includes(term)
            );
          }
          return true;
        })
        .sort((a, b) => {
          const orderA = LEVEL_SORT_ORDER[a.processingLevel ?? 'unknown'] ?? 4;
          const orderB = LEVEL_SORT_ORDER[b.processingLevel ?? 'unknown'] ?? 4;
          if (orderA !== orderB) return orderA - orderB;
          return a.fileName.localeCompare(b.fileName);
        }),
    [allImages, searchTerm]
  );

  // Toggle file selection
  const toggleFileSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectFiltered = useCallback(() => {
    setSelectedIds(new Set(filteredImages.map((img) => img.id)));
  }, [filteredImages]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // Get selected images as array
  const selectedImages = useMemo(
    () =>
      selectedIdList
        .map((id) => allImages.find((img) => img.id === id))
        .filter((img): img is JwstDataModel => img !== undefined),
    [allImages, selectedIdList]
  );

  const normalizedOutputWidth = outputWidth.trim();
  const normalizedOutputHeight = outputHeight.trim();
  const outputWidthValue =
    normalizedOutputWidth === '' ? null : Number(normalizedOutputWidth);
  const outputHeightValue =
    normalizedOutputHeight === '' ? null : Number(normalizedOutputHeight);
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

  // Load footprints when entering step 2
  const loadFootprints = useCallback(async () => {
    if (selectedIdList.length < 2) return;

    setFootprintLoading(true);
    setFootprintError(null);
    setFootprintData(null);

    footprintAbortRef.current?.abort();
    const controller = new AbortController();
    footprintAbortRef.current = controller;

    try {
      const data = await mosaicService.getFootprints(selectedIdList, controller.signal);
      setFootprintData(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setFootprintError(err instanceof Error ? err.message : 'Failed to load footprints');
    } finally {
      setFootprintLoading(false);
      if (footprintAbortRef.current === controller) {
        footprintAbortRef.current = null;
      }
    }
  }, [selectedIdList]);

  // Clear stale footprint preview/error after selection changes.
  useEffect(() => {
    setFootprintData(null);
    setFootprintError(null);
  }, [selectedIdList]);

  // Generate mosaic
  const handleGenerate = useCallback(async () => {
    if (selectedIdList.length < 2) return;
    if (dimensionError) {
      setGenerateError(dimensionError);
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    setResultBlob(null);

    const files: MosaicFileConfig[] = selectedIdList.map((id) => ({
      dataId: id,
      ...DEFAULT_MOSAIC_FILE_PARAMS,
      stretch,
    }));

    const request: MosaicRequest = {
      files,
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
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGenerateError(err instanceof Error ? err.message : 'Mosaic generation failed');
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
    selectedIdList,
    stretch,
  ]);

  // Export/download
  const handleExport = useCallback(() => {
    if (!resultBlob) return;
    const filename = mosaicService.generateMosaicFilename(outputFormat);
    mosaicService.downloadMosaic(resultBlob, filename);
  }, [resultBlob, outputFormat]);

  // Navigation
  const canProceedToStep2 = selectedIds.size >= 2;
  const canProceedToStep3 = canProceedToStep2;

  const handleNext = () => {
    if (currentStep === 1 && canProceedToStep2) {
      setCurrentStep(2);
      loadFootprints();
    } else if (currentStep === 2 && canProceedToStep3) {
      setCurrentStep(3);
    }
  };

  const handleBack = () => {
    if (currentStep === 2) {
      footprintAbortRef.current?.abort();
      setCurrentStep(1);
    } else if (currentStep === 3) {
      generateAbortRef.current?.abort();
      setCurrentStep(2);
    }
  };

  const handleStepClick = (step: number) => {
    if (step === 1) {
      setCurrentStep(1);
    } else if (step === 2 && canProceedToStep2) {
      setCurrentStep(2);
      loadFootprints();
    } else if (step === 3 && canProceedToStep3) {
      setCurrentStep(3);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="mosaic-wizard-backdrop" onClick={handleBackdropClick}>
      <div className="mosaic-wizard-modal">
        <header className="mosaic-wizard-header">
          <h2 className="mosaic-wizard-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#4488ff" />
              <rect x="13" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#44ddff" />
              <rect x="2" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#8844ff" />
              <rect x="13" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#44ff88" />
            </svg>
            WCS Mosaic Creator
          </h2>
          <button
            className="mosaic-btn-close"
            onClick={onClose}
            aria-label="Close wizard"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        {/* Stepper */}
        <div className="mosaic-stepper">
          {WIZARD_STEPS.map((step) => (
            <button
              key={step.number}
              className={`mosaic-step ${currentStep === step.number ? 'active' : ''} ${currentStep > step.number ? 'completed' : ''}`}
              onClick={() => handleStepClick(step.number)}
              type="button"
              aria-current={currentStep === step.number ? 'step' : undefined}
              disabled={
                (step.number === 2 && !canProceedToStep2) ||
                (step.number === 3 && !canProceedToStep3)
              }
            >
              <span className="mosaic-step-number">{step.number}</span>
              <span className="mosaic-step-label">{step.label}</span>
            </button>
          ))}
        </div>

        <main className="mosaic-wizard-content">
          {/* Step 1: File Selection */}
          {currentStep === 1 && (
            <div className="mosaic-step-content">
              <p className="mosaic-step-description">
                Select 2 or more FITS image files to combine into a WCS-aligned mosaic.
              </p>
              <div className="mosaic-search-bar">
                <input
                  type="text"
                  placeholder="Search by filename, target, filter, or instrument..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="mosaic-search-input"
                />
                <span className="mosaic-selection-count">{selectedIds.size} selected (min 2)</span>
                <div className="mosaic-selection-actions">
                  <button
                    type="button"
                    className="mosaic-selection-btn"
                    onClick={handleSelectFiltered}
                    disabled={filteredImages.length === 0}
                  >
                    Select Filtered
                  </button>
                  <button
                    type="button"
                    className="mosaic-selection-btn"
                    onClick={handleClearSelection}
                    disabled={selectedIds.size === 0}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mosaic-file-list">
                {filteredImages.length === 0 ? (
                  <p className="mosaic-empty">No viewable images found.</p>
                ) : (
                  filteredImages.map((img) => {
                    const isSelected = selectedIds.has(img.id);
                    return (
                      <div
                        key={img.id}
                        className={`mosaic-file-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleFileSelection(img.id)}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleFileSelection(img.id);
                          }
                        }}
                      >
                        <span className={`mosaic-checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected ? '\u2713' : ''}
                        </span>
                        <div className="mosaic-file-info">
                          <div className="mosaic-file-name-row">
                            <span className="mosaic-file-name">{img.fileName}</span>
                            {img.processingLevel && img.processingLevel !== 'unknown' && (
                              <span
                                className="mosaic-level-badge"
                                style={{
                                  backgroundColor:
                                    ProcessingLevelColors[img.processingLevel] || '#6b7280',
                                }}
                                title={
                                  ProcessingLevelLabels[img.processingLevel] || img.processingLevel
                                }
                              >
                                {img.processingLevel}
                              </span>
                            )}
                          </div>
                          <span className="mosaic-file-meta">
                            {[
                              img.imageInfo?.targetName,
                              img.imageInfo?.filter,
                              img.imageInfo?.instrument,
                            ]
                              .filter(Boolean)
                              .join(' | ') || img.dataType}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Step 2: Configuration + Footprint Preview */}
          {currentStep === 2 && (
            <div className="mosaic-step-content mosaic-configure-step">
              <div className="mosaic-configure-layout">
                <div className="mosaic-settings-panel">
                  <h3>Mosaic Settings</h3>
                  <div className="mosaic-setting">
                    <label htmlFor="mosaic-combine">Combine Method</label>
                    <select
                      id="mosaic-combine"
                      value={combineMethod}
                      onChange={(e) =>
                        setCombineMethod(e.target.value as MosaicRequest['combineMethod'])
                      }
                    >
                      {COMBINE_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label} - {m.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mosaic-setting">
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
                  <div className="mosaic-setting">
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
                  <div className="mosaic-selected-files">
                    <h4>Selected Files ({selectedImages.length})</h4>
                    {selectedImages.map((img) => (
                      <div key={img.id} className="mosaic-selected-file-item">
                        <span className="mosaic-selected-file-name" title={img.fileName}>
                          {img.fileName}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mosaic-footprint-panel">
                  <h3>WCS Footprint Preview</h3>
                  {footprintLoading && (
                    <div className="mosaic-footprint-loading">
                      <div className="mosaic-spinner" />
                      <span>Loading footprints...</span>
                    </div>
                  )}
                  {footprintError && (
                    <div className="mosaic-footprint-error">
                      <p>{footprintError}</p>
                      <button onClick={loadFootprints} className="mosaic-btn-retry" type="button">
                        Retry
                      </button>
                    </div>
                  )}
                  {!footprintLoading && !footprintError && !footprintData && (
                    <p className="mosaic-footprint-empty">No footprint data to display yet.</p>
                  )}
                  {footprintData && !footprintLoading && (
                    <FootprintPreview
                      footprintData={footprintData}
                      selectedImages={selectedImages}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Generate + Export */}
          {currentStep === 3 && (
            <div className="mosaic-step-content mosaic-generate-step">
              <div className="mosaic-generate-controls">
                <div className="mosaic-export-settings">
                  <div className="mosaic-setting">
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
                  <div className="mosaic-setting mosaic-setting-dimensions">
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
                  {outputFormat === 'jpeg' && (
                    <div className="mosaic-setting">
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
                </div>
                <button
                  className="mosaic-btn-generate"
                  onClick={handleGenerate}
                  disabled={generating || Boolean(dimensionError)}
                  type="button"
                >
                  {generating ? (
                    <>
                      <div className="mosaic-spinner small" />
                      Generating Mosaic...
                    </>
                  ) : (
                    'Generate Mosaic'
                  )}
                </button>
              </div>

              {generateError && (
                <div className="mosaic-generate-error">
                  <p>{generateError}</p>
                </div>
              )}

              {resultUrl && (
                <div className="mosaic-result">
                  <div className="mosaic-result-image-container">
                    <img
                      src={resultUrl}
                      alt="Generated WCS mosaic"
                      className="mosaic-result-image"
                    />
                  </div>
                  <div className="mosaic-result-actions">
                    <button className="mosaic-btn-export" onClick={handleExport} type="button">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                      </svg>
                      Download {outputFormat.toUpperCase()}
                    </button>
                    <span className="mosaic-result-info">
                      {selectedImages.length} files | {combineMethod} | {cmap} | {outputDimensionLabel}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="mosaic-wizard-footer">
          <button
            className="mosaic-btn mosaic-btn-secondary"
            onClick={handleBack}
            disabled={currentStep === 1}
            type="button"
          >
            Back
          </button>
          <div className="mosaic-footer-spacer" />
          {currentStep < 3 ? (
            <button
              className="mosaic-btn mosaic-btn-primary"
              onClick={handleNext}
              disabled={
                (currentStep === 1 && !canProceedToStep2) ||
                (currentStep === 2 && !canProceedToStep3)
              }
              type="button"
            >
              Next
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          ) : (
            <button className="mosaic-btn mosaic-btn-success" onClick={onClose} type="button">
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

/**
 * SVG-based footprint visualization showing WCS coverage rectangles
 */
const FootprintPreview: React.FC<{
  footprintData: FootprintResponse;
  selectedImages: JwstDataModel[];
}> = ({ footprintData, selectedImages }) => {
  const { footprints, bounding_box } = footprintData;
  const patternId = useId().replace(/:/g, '_');

  if (footprints.length === 0) {
    return <p className="mosaic-footprint-empty">No WCS data found in selected files.</p>;
  }

  // SVG viewport dimensions
  const svgWidth = 400;
  const svgHeight = 300;
  const padding = 30;

  // Coordinate range with padding
  const raRange = bounding_box.max_ra - bounding_box.min_ra;
  const decRange = bounding_box.max_dec - bounding_box.min_dec;
  const padFactor = 0.1;
  const minRa = bounding_box.min_ra - raRange * padFactor;
  const maxRa = bounding_box.max_ra + raRange * padFactor;
  const minDec = bounding_box.min_dec - decRange * padFactor;
  const maxDec = bounding_box.max_dec + decRange * padFactor;
  const totalRa = maxRa - minRa || 1;
  const totalDec = maxDec - minDec || 1;

  // Map RA/Dec to SVG coordinates
  // RA increases to the left in astronomical convention
  const toSvgX = (ra: number) => padding + ((maxRa - ra) / totalRa) * (svgWidth - 2 * padding);
  const toSvgY = (dec: number) => padding + ((maxDec - dec) / totalDec) * (svgHeight - 2 * padding);

  // Colors for different files
  const colors = ['#4488ff', '#44ddff', '#ff8844', '#44ff88', '#ff44aa', '#ffdd44', '#aa44ff'];

  return (
    <div className="mosaic-footprint-svg-container">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="mosaic-footprint-svg"
        aria-label="WCS footprint preview showing sky coverage of selected files"
      >
        {/* Grid lines */}
        <defs>
          <pattern id={patternId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width={svgWidth} height={svgHeight} fill="#1a1a2e" rx="4" />
        <rect
          x={padding}
          y={padding}
          width={svgWidth - 2 * padding}
          height={svgHeight - 2 * padding}
          fill={`url(#${patternId})`}
        />

        {/* Bounding box */}
        <rect
          x={toSvgX(bounding_box.max_ra)}
          y={toSvgY(bounding_box.max_dec)}
          width={toSvgX(bounding_box.min_ra) - toSvgX(bounding_box.max_ra)}
          height={toSvgY(bounding_box.min_dec) - toSvgY(bounding_box.max_dec)}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          strokeDasharray="4 2"
        />

        {/* Footprint polygons */}
        {footprints.map((fp, i) => {
          const color = colors[i % colors.length];
          const points = fp.corners_ra
            .map((ra, j) => `${toSvgX(ra)},${toSvgY(fp.corners_dec[j])}`)
            .join(' ');
          return (
            <g key={i}>
              <polygon
                points={points}
                fill={color}
                fillOpacity="0.15"
                stroke={color}
                strokeWidth="1.5"
                strokeOpacity="0.8"
              />
              <circle
                cx={toSvgX(fp.center_ra)}
                cy={toSvgY(fp.center_dec)}
                r="3"
                fill={color}
                opacity="0.9"
              />
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={svgWidth / 2} y={svgHeight - 5} textAnchor="middle" fill="#888" fontSize="10">
          RA (deg)
        </text>
        <text
          x="10"
          y={svgHeight / 2}
          textAnchor="middle"
          fill="#888"
          fontSize="10"
          transform={`rotate(-90, 10, ${svgHeight / 2})`}
        >
          Dec (deg)
        </text>

        {/* Corner labels */}
        <text x={padding} y={svgHeight - padding + 15} fill="#666" fontSize="8">
          {maxRa.toFixed(4)}
        </text>
        <text
          x={svgWidth - padding}
          y={svgHeight - padding + 15}
          fill="#666"
          fontSize="8"
          textAnchor="end"
        >
          {minRa.toFixed(4)}
        </text>
        <text x={padding - 5} y={padding + 3} fill="#666" fontSize="8" textAnchor="end">
          {maxDec.toFixed(4)}
        </text>
        <text x={padding - 5} y={svgHeight - padding} fill="#666" fontSize="8" textAnchor="end">
          {minDec.toFixed(4)}
        </text>
      </svg>

      {/* Legend */}
      <div className="mosaic-footprint-legend">
        {footprints.map((fp, i) => {
          const color = colors[i % colors.length];
          const matchingImage = selectedImages.find((img) =>
            fp.file_path.includes(img.fileName.replace('.fits.gz', '.fits').replace('.fits', ''))
          );
          const label = matchingImage?.fileName || fp.file_path.split('/').pop() || `File ${i + 1}`;
          return (
            <div key={i} className="mosaic-footprint-legend-item">
              <span className="mosaic-legend-color" style={{ backgroundColor: color }} />
              <span className="mosaic-legend-label" title={label}>
                {label.length > 25 ? label.slice(0, 22) + '...' : label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MosaicWizard;
