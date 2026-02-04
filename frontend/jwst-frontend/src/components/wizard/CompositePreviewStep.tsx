import React, { useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  ChannelAssignment,
  ChannelParams,
  ExportOptions,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_EXPORT_OPTIONS,
} from '../../types/CompositeTypes';
import { compositeService } from '../../services';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import './CompositePreviewStep.css';

interface CompositePreviewStepProps {
  selectedImages: JwstDataModel[];
  channelAssignment: ChannelAssignment;
  channelParams: ChannelParams;
}

/**
 * Step 3: Final preview and export options
 */
export const CompositePreviewStep: React.FC<CompositePreviewStepProps> = ({
  selectedImages,
  channelAssignment,
  channelParams,
}) => {
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getImageById = (id: string | null): JwstDataModel | null => {
    if (!id) return null;
    return selectedImages.find((img) => img.id === id) || null;
  };

  // Generate high-quality preview on mount
  useEffect(() => {
    generatePreview();

    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const generatePreview = async () => {
    const { red, green, blue } = channelAssignment;
    if (!red || !green || !blue) return;

    setPreviewLoading(true);
    setPreviewError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const redParams = channelParams[red] || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams[green] || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams[blue] || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.generatePreview(
        { dataId: red, ...redParams },
        { dataId: green, ...greenParams },
        { dataId: blue, ...blueParams },
        1000, // Larger preview for final step
        abortControllerRef.current.signal
      );

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPreviewError('Failed to generate preview');
        console.error('Preview generation error:', err);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExport = async () => {
    const { red, green, blue } = channelAssignment;
    if (!red || !green || !blue) return;

    setExporting(true);

    try {
      const redParams = channelParams[red] || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams[green] || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams[blue] || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.exportComposite(
        { dataId: red, ...redParams },
        { dataId: green, ...greenParams },
        { dataId: blue, ...blueParams },
        exportOptions.format,
        exportOptions.quality,
        exportOptions.width,
        exportOptions.height
      );

      const filename = compositeService.generateFilename(exportOptions.format);
      compositeService.downloadComposite(blob, filename);
    } catch (err) {
      console.error('Export error:', err);
      setPreviewError('Failed to export composite');
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
          <div className="channel-item red">
            <span className="channel-label">Red</span>
            <span className="channel-value">
              {channelAssignment.red
                ? getFilterLabel(getImageById(channelAssignment.red) ?? ({} as JwstDataModel))
                : 'Not assigned'}
            </span>
          </div>
          <div className="channel-item green">
            <span className="channel-label">Green</span>
            <span className="channel-value">
              {channelAssignment.green
                ? getFilterLabel(getImageById(channelAssignment.green) ?? ({} as JwstDataModel))
                : 'Not assigned'}
            </span>
          </div>
          <div className="channel-item blue">
            <span className="channel-label">Blue</span>
            <span className="channel-value">
              {channelAssignment.blue
                ? getFilterLabel(getImageById(channelAssignment.blue) ?? ({} as JwstDataModel))
                : 'Not assigned'}
            </span>
          </div>
        </div>
      </div>

      <div className="export-section">
        <h3 className="export-title">Export Options</h3>

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
                max="8000"
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
                max="8000"
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
              <span>Download {exportOptions.format.toUpperCase()}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CompositePreviewStep;
