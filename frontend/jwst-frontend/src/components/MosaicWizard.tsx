import React, { useState, useCallback, useEffect, useRef } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import {
  MosaicFileConfig,
  MosaicRequest,
  FootprintResponse,
  MosaicWizardStep,
  DEFAULT_MOSAIC_FILE_PARAMS,
  COMBINE_METHODS,
  MOSAIC_COLORMAPS,
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
  const [combineMethod, setCombineMethod] = useState<string>('mean');
  const [cmap, setCmap] = useState<string>('inferno');
  const [stretch, setStretch] = useState<string>('asinh');
  const [footprintData, setFootprintData] = useState<FootprintResponse | null>(null);
  const [footprintLoading, setFootprintLoading] = useState(false);
  const [footprintError, setFootprintError] = useState<string | null>(null);

  // Step 3: Generate + export
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(95);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      abortRef.current?.abort();
    };
  }, [resultUrl]);

  // Filter images for selection
  const filteredImages = allImages.filter((img) => {
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
  });

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

  // Get selected images as array
  const selectedImages = Array.from(selectedIds)
    .map((id) => allImages.find((img) => img.id === id))
    .filter((img): img is JwstDataModel => img !== undefined);

  // Load footprints when entering step 2
  const loadFootprints = useCallback(async () => {
    if (selectedIds.size < 2) return;

    setFootprintLoading(true);
    setFootprintError(null);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const data = await mosaicService.getFootprints(Array.from(selectedIds), controller.signal);
      setFootprintData(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setFootprintError(err instanceof Error ? err.message : 'Failed to load footprints');
    } finally {
      setFootprintLoading(false);
    }
  }, [selectedIds]);

  // Generate mosaic
  const handleGenerate = useCallback(async () => {
    if (selectedIds.size < 2) return;

    setGenerating(true);
    setGenerateError(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    setResultBlob(null);

    const files: MosaicFileConfig[] = Array.from(selectedIds).map((id) => ({
      dataId: id,
      ...DEFAULT_MOSAIC_FILE_PARAMS,
      stretch,
    }));

    const request: MosaicRequest = {
      files,
      outputFormat,
      quality,
      combineMethod: combineMethod as MosaicRequest['combineMethod'],
      cmap,
    };

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const blob = await mosaicService.generateMosaic(request, controller.signal);
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGenerateError(err instanceof Error ? err.message : 'Mosaic generation failed');
    } finally {
      setGenerating(false);
    }
  }, [selectedIds, combineMethod, cmap, stretch, outputFormat, quality, resultUrl]);

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
      setCurrentStep(1);
    } else if (currentStep === 3) {
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
          <button className="mosaic-btn-close" onClick={onClose} aria-label="Close wizard">
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
                          <span className="mosaic-file-name">{img.fileName}</span>
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
                      onChange={(e) => setCombineMethod(e.target.value)}
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
                    <select id="mosaic-cmap" value={cmap} onChange={(e) => setCmap(e.target.value)}>
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
                      onChange={(e) => setStretch(e.target.value)}
                    >
                      {['asinh', 'zscale', 'log', 'sqrt', 'power', 'histeq', 'linear'].map((s) => (
                        <option key={s} value={s}>
                          {s}
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
                      <button onClick={loadFootprints} className="mosaic-btn-retry">
                        Retry
                      </button>
                    </div>
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
                  disabled={generating}
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
                    <button className="mosaic-btn-export" onClick={handleExport}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                      </svg>
                      Download {outputFormat.toUpperCase()}
                    </button>
                    <span className="mosaic-result-info">
                      {selectedImages.length} files | {combineMethod} | {cmap}
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
            >
              Next
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          ) : (
            <button className="mosaic-btn mosaic-btn-success" onClick={onClose}>
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
          <pattern id="mosaic-grid" width="40" height="40" patternUnits="userSpaceOnUse">
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
          fill="url(#mosaic-grid)"
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
