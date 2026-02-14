import React, { useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  ChannelAssignment,
  ChannelName,
  ChannelParams,
  ChannelStretchParams,
  ExportOptions,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_OVERALL_ADJUSTMENTS,
  OverallAdjustments,
  StretchMethod,
} from '../../types/CompositeTypes';
import { compositeService } from '../../services';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import StretchControls from '../StretchControls';
import './CompositePreviewStep.css';

const STRETCH_OPTIONS: Array<{ value: StretchMethod; label: string; description: string }> = [
  { value: 'zscale', label: 'ZScale', description: 'Automatic robust scaling (default)' },
  { value: 'asinh', label: 'Asinh', description: 'High dynamic range, preserves faint detail' },
  { value: 'log', label: 'Logarithmic', description: 'Extended emission, nebulae' },
  { value: 'sqrt', label: 'Square Root', description: 'Moderate compression' },
  { value: 'power', label: 'Power Law', description: 'Customizable with gamma' },
  { value: 'histeq', label: 'Histogram Eq.', description: 'Maximum contrast' },
  { value: 'linear', label: 'Linear', description: 'No compression' },
];

interface CompositePreviewStepProps {
  selectedImages: JwstDataModel[];
  channelAssignment: ChannelAssignment;
  channelParams: ChannelParams;
  onChannelParamsChange: (params: ChannelParams) => void;
  onExportComplete?: () => void;
}

const CHANNEL_COLORS: Record<ChannelName, string> = {
  red: '#ff4444',
  green: '#44ff44',
  blue: '#4488ff',
};

const CHANNEL_LABELS: Record<ChannelName, string> = {
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
};

/**
 * Step 2: Preview & Export with overall + per-channel stretch controls
 */
export const CompositePreviewStep: React.FC<CompositePreviewStepProps> = ({
  selectedImages,
  channelAssignment,
  channelParams,
  onChannelParamsChange,
  onExportComplete,
}) => {
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [overallAdjustments, setOverallAdjustments] = useState<OverallAdjustments>({
    ...DEFAULT_OVERALL_ADJUSTMENTS,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [channelCollapsed, setChannelCollapsed] = useState<Record<ChannelName, boolean>>({
    red: true,
    green: true,
    blue: true,
  });
  const [perChannelExpanded, setPerChannelExpanded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const handleChannelParamChange = (channel: ChannelName, params: ChannelStretchParams) => {
    onChannelParamsChange({
      ...channelParams,
      [channel]: params,
    });
  };

  const toggleChannelCollapsed = (channel: ChannelName) => {
    setChannelCollapsed((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  const getImagesForChannel = (channel: 'red' | 'green' | 'blue'): JwstDataModel[] => {
    return channelAssignment[channel]
      .map((id) => selectedImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
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
  }, [channelAssignment, channelParams, overallAdjustments]);

  // Cleanup object URL and in-flight request on unmount.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const generatePreview = async () => {
    const { red, green, blue } = channelAssignment;
    if (red.length === 0 || green.length === 0 || blue.length === 0) return;

    setPreviewLoading(true);
    setPreviewError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const redParams = channelParams.red || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams.green || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams.blue || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.generatePreview(
        { dataIds: red, ...redParams },
        { dataIds: green, ...greenParams },
        { dataIds: blue, ...blueParams },
        1000, // Larger preview for final step
        overallAdjustments,
        controller.signal
      );

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      const nextPreviewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = nextPreviewUrl;
      setPreviewUrl(nextPreviewUrl);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPreviewError('Failed to generate preview');
        console.error('Preview generation error:', err);
      }
    } finally {
      // Only clear loading if this is still the active request.
      // If another request superseded us (via abort), it owns the loading state.
      if (abortControllerRef.current === controller) {
        setPreviewLoading(false);
      }
    }
  };

  const handleExport = async () => {
    const { red, green, blue } = channelAssignment;
    if (red.length === 0 || green.length === 0 || blue.length === 0) return;

    setExporting(true);

    try {
      const redParams = channelParams.red || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams.green || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams.blue || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.exportComposite(
        { dataIds: red, ...redParams },
        { dataIds: green, ...greenParams },
        { dataIds: blue, ...blueParams },
        exportOptions.format,
        exportOptions.quality,
        exportOptions.width,
        exportOptions.height,
        overallAdjustments
      );

      const filename = compositeService.generateFilename(exportOptions.format);

      // Log for debugging
      console.warn('Export successful, blob size:', blob.size, 'filename:', filename);

      compositeService.downloadComposite(blob, filename);

      // Close wizard after successful download
      if (onExportComplete) {
        // Small delay to ensure download starts
        setTimeout(() => {
          onExportComplete();
        }, 500);
      }
    } catch (err) {
      console.error('Export error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setPreviewError(`Failed to export: ${errorMessage}`);
    } finally {
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
    setOverallAdjustments((prev) => ({
      ...prev,
      gamma: value,
    }));
  };

  const handleOverallBlackPointChange = (value: number) => {
    setOverallAdjustments((prev) => ({
      ...prev,
      blackPoint: Math.min(value, prev.whitePoint - 0.01),
    }));
  };

  const handleOverallWhitePointChange = (value: number) => {
    setOverallAdjustments((prev) => ({
      ...prev,
      whitePoint: Math.max(value, prev.blackPoint + 0.01),
    }));
  };

  const handleOverallStretchChange = (value: StretchMethod) => {
    setOverallAdjustments((prev) => ({
      ...prev,
      stretch: value,
    }));
  };

  const handleOverallAsinhAChange = (value: number) => {
    setOverallAdjustments((prev) => ({
      ...prev,
      asinhA: value,
    }));
  };

  const handleOverallReset = () => {
    setOverallAdjustments({ ...DEFAULT_OVERALL_ADJUSTMENTS });
  };

  const resolutionPresets = [
    { label: 'HD (1920x1080)', width: 1920, height: 1080 },
    { label: '2K (2048x2048)', width: 2048, height: 2048 },
    { label: '4K (4096x4096)', width: 4096, height: 4096 },
  ];

  return (
    <div className="composite-preview-step">
      <div className="preview-section">
        <div className="preview-container large">
          {previewLoading && (
            <div className="preview-loading">
              <div className="spinner" />
              <span>Generating high-quality preview...</span>
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="preview-error">
              <span>{previewError}</span>
              <button className="btn-retry" onClick={generatePreview}>
                Retry
              </button>
            </div>
          )}
          {previewUrl && !previewLoading && (
            <img src={previewUrl} alt="Final composite preview" className="preview-image" />
          )}
        </div>

        {/* Channel info */}
        <div className="channel-summary">
          {(['red', 'green', 'blue'] as const).map((ch) => {
            const images = getImagesForChannel(ch);
            const displayText =
              images.length === 0
                ? 'Not assigned'
                : images.length <= 2
                  ? images.map((img) => getFilterLabel(img)).join(', ')
                  : `${images.length} filters`;
            return (
              <div key={ch} className={`channel-item ${ch}`}>
                <span className="channel-label">{ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
                <span className="channel-value">{displayText}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="export-section">
        <h3 className="export-title">Export Options</h3>

        <div className="option-group overall-adjustments-group">
          <div className="overall-header">
            <label className="option-label">Overall Levels &amp; Stretch</label>
            <button className="btn-overall-reset" type="button" onClick={handleOverallReset}>
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
        </div>

        {/* Per-channel adjustments */}
        <div className="option-group per-channel-group">
          <button
            className={`per-channel-toggle ${perChannelExpanded ? 'expanded' : ''}`}
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
          {perChannelExpanded && (
            <div className="per-channel-controls">
              {(['red', 'green', 'blue'] as const).map((channel) => {
                const images = getImagesForChannel(channel);
                if (images.length === 0) return null;
                return (
                  <div
                    key={channel}
                    className="per-channel-item"
                    style={{ '--channel-color': CHANNEL_COLORS[channel] } as React.CSSProperties}
                  >
                    <div className="per-channel-label">
                      <span className="per-channel-dot" />
                      <span>{CHANNEL_LABELS[channel]}</span>
                      <span className="per-channel-filter">
                        {images.map((img) => getFilterLabel(img)).join(', ')}
                      </span>
                    </div>
                    <StretchControls
                      params={channelParams[channel]}
                      onChange={(params) =>
                        handleChannelParamChange(channel, params as ChannelStretchParams)
                      }
                      collapsed={channelCollapsed[channel]}
                      onToggleCollapse={() => toggleChannelCollapsed(channel)}
                    />
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
              className={`format-btn ${exportOptions.format === 'png' ? 'active' : ''}`}
              onClick={() => handleOptionChange('format', 'png')}
              type="button"
            >
              PNG
              <span className="format-hint">Lossless</span>
            </button>
            <button
              className={`format-btn ${exportOptions.format === 'jpeg' ? 'active' : ''}`}
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
                className={`preset-btn ${
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
            <span className="dimension-separator">×</span>
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

        {/* Export button */}
        <button
          className="btn-export"
          onClick={handleExport}
          disabled={exporting || !previewUrl}
          type="button"
        >
          {exporting ? (
            <>
              <div className="spinner small" />
              <span>Exporting...</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
              <span>Export &amp; Download {exportOptions.format.toUpperCase()}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CompositePreviewStep;
