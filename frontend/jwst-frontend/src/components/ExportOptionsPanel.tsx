import React, { useState } from 'react';
import './ExportOptionsPanel.css';
import {
  ExportOptions,
  ExportFormat,
  ExportResolutionPresets,
  ExportResolutionPreset,
} from '../types/JwstDataTypes';

interface ExportOptionsPanelProps {
  onExport: (options: ExportOptions) => void;
  onClose: () => void;
  isExporting: boolean;
  disabled?: boolean;
}

// SVG Icons
const Icons = {
  Close: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  ),
  Export: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  ),
};

const ExportOptionsPanel: React.FC<ExportOptionsPanelProps> = ({
  onExport,
  onClose,
  isExporting,
  disabled = false,
}) => {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState<number>(90);
  const [resolution, setResolution] = useState<ExportResolutionPreset>('standard');
  const [customWidth, setCustomWidth] = useState<number>(1200);
  const [customHeight, setCustomHeight] = useState<number>(1200);

  const handleExport = () => {
    const preset = ExportResolutionPresets[resolution];
    const width = resolution === 'custom' ? customWidth : preset.width;
    const height = resolution === 'custom' ? customHeight : preset.height;

    onExport({
      format,
      quality,
      width,
      height,
    });
  };

  const handleCustomWidthChange = (value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setCustomWidth(Math.min(8000, Math.max(10, num)));
    }
  };

  const handleCustomHeightChange = (value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setCustomHeight(Math.min(8000, Math.max(10, num)));
    }
  };

  return (
    <div className="export-options-panel">
      <div className="export-options-header">
        <span className="export-options-title">Export Image</span>
        <button
          className="export-close-btn"
          onClick={onClose}
          title="Close"
          aria-label="Close export options"
        >
          <Icons.Close />
        </button>
      </div>

      <div className="export-options-body">
        {/* Format Selection */}
        <div className="export-control-group">
          <label className="export-control-label">Format</label>
          <div className="export-format-buttons">
            <button
              className={`export-format-btn ${format === 'png' ? 'active' : ''}`}
              onClick={() => setFormat('png')}
            >
              PNG
            </button>
            <button
              className={`export-format-btn ${format === 'jpeg' ? 'active' : ''}`}
              onClick={() => setFormat('jpeg')}
            >
              JPEG
            </button>
          </div>
          <span className="export-format-hint">
            {format === 'png' ? 'Lossless, larger file size' : 'Smaller file size, adjustable quality'}
          </span>
        </div>

        {/* Quality Slider (JPEG only) */}
        {format === 'jpeg' && (
          <div className="export-control-group">
            <div className="export-control-label-row">
              <label className="export-control-label">Quality</label>
              <span className="export-control-value">{quality}%</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value, 10))}
              className="export-slider"
            />
            <div className="export-slider-labels">
              <span>Smaller</span>
              <span>Higher quality</span>
            </div>
          </div>
        )}

        {/* Resolution Selection */}
        <div className="export-control-group">
          <label className="export-control-label">Resolution</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ExportResolutionPreset)}
            className="export-select"
          >
            <option value="standard">{ExportResolutionPresets.standard.label}</option>
            <option value="high">{ExportResolutionPresets.high.label}</option>
            <option value="maximum">{ExportResolutionPresets.maximum.label}</option>
            <option value="custom">{ExportResolutionPresets.custom.label}</option>
          </select>
        </div>

        {/* Custom Resolution Inputs */}
        {resolution === 'custom' && (
          <div className="export-control-group export-custom-resolution">
            <div className="export-dimension-inputs">
              <div className="export-dimension-field">
                <label className="export-dimension-label">Width</label>
                <input
                  type="number"
                  min="10"
                  max="8000"
                  value={customWidth}
                  onChange={(e) => handleCustomWidthChange(e.target.value)}
                  className="export-dimension-input"
                />
                <span className="export-dimension-unit">px</span>
              </div>
              <span className="export-dimension-separator">x</span>
              <div className="export-dimension-field">
                <label className="export-dimension-label">Height</label>
                <input
                  type="number"
                  min="10"
                  max="8000"
                  value={customHeight}
                  onChange={(e) => handleCustomHeightChange(e.target.value)}
                  className="export-dimension-input"
                />
                <span className="export-dimension-unit">px</span>
              </div>
            </div>
            <span className="export-dimension-hint">10-8000 pixels</span>
          </div>
        )}
      </div>

      <div className="export-options-footer">
        <button
          className="export-btn-primary"
          onClick={handleExport}
          disabled={disabled || isExporting}
        >
          {isExporting ? (
            <>
              <span className="export-spinner"></span>
              Exporting...
            </>
          ) : (
            <>
              <Icons.Export />
              Export {format.toUpperCase()}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ExportOptionsPanel;
