import React, { useCallback, useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  NChannelState,
  NChannelConfigPayload,
  ChannelStretchParams,
  ExportOptions,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_OVERALL_ADJUSTMENTS,
  OverallAdjustments,
  StretchMethod,
} from '../../types/CompositeTypes';
import { compositeService } from '../../services';
import { getFilterLabel, channelColorToHex } from '../../utils/wavelengthUtils';
import StretchControls, { StretchParams } from '../StretchControls';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [channelCollapsed, setChannelCollapsed] = useState<Record<string, boolean>>(() => {
    const collapsed: Record<string, boolean> = {};
    channels.forEach((ch) => {
      collapsed[ch.id] = true;
    });
    return collapsed;
  });
  // Sync channelCollapsed when channels change (e.g. user adds channels in Step 1 then returns)
  useEffect(() => {
    setChannelCollapsed((prev) => {
      const next = { ...prev };
      for (const ch of channels) {
        if (!(ch.id in next)) {
          next[ch.id] = true;
        }
      }
      return next;
    });
  }, [channels]);

  const [perChannelExpanded, setPerChannelExpanded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const handleChannelParamChange = (channelId: string, params: StretchParams) => {
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
      }));
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
  }, [channels, overallAdjustments, backgroundNeutralization]);

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
    const payloads = buildPayloads();
    if (payloads.length === 0) return;

    setPreviewLoading(true);
    setPreviewError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const blob = await compositeService.generateNChannelPreview(
        payloads,
        1000,
        overallAdjustments,
        controller.signal,
        backgroundNeutralization
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
      if (abortControllerRef.current === controller) {
        setPreviewLoading(false);
      }
    }
  };

  const handleExport = async () => {
    const payloads = buildPayloads();
    if (payloads.length === 0) return;

    setExporting(true);

    try {
      const blob = await compositeService.exportNChannelComposite(
        payloads,
        exportOptions.format,
        exportOptions.quality,
        exportOptions.width,
        exportOptions.height,
        overallAdjustments,
        undefined,
        backgroundNeutralization
      );

      const filename = compositeService.generateFilename(exportOptions.format);
      console.warn('Export successful, blob size:', blob.size, 'filename:', filename);
      compositeService.downloadComposite(blob, filename);

      if (onExportComplete) {
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
    setOverallAdjustments((prev) => ({ ...prev, gamma: value }));
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
    setOverallAdjustments((prev) => ({ ...prev, stretch: value }));
  };

  const handleOverallAsinhAChange = (value: number) => {
    setOverallAdjustments((prev) => ({ ...prev, asinhA: value }));
  };

  const handleOverallReset = () => {
    setOverallAdjustments({ ...DEFAULT_OVERALL_ADJUSTMENTS });
  };

  const handleWeightChange = (channelId: string, weight: number) => {
    onChannelsChange(
      channels.map((ch) => (ch.id === channelId ? { ...ch, params: { ...ch.params, weight } } : ch))
    );
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
              className={`toggle-switch ${backgroundNeutralization ? 'active' : ''}`}
              onClick={() => setBackgroundNeutralization((prev) => !prev)}
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
              {channels.map((ch) => {
                const images = getImagesForChannel(ch);
                if (images.length === 0) return null;
                const color = channelColorToHex(ch.color);
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
                    </div>
                    <StretchControls
                      params={ch.params || DEFAULT_CHANNEL_PARAMS}
                      onChange={(params) => handleChannelParamChange(ch.id, params)}
                      collapsed={channelCollapsed[ch.id] ?? true}
                      onToggleCollapse={() => toggleChannelCollapsed(ch.id)}
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
