import { useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadComposite, generateFilename } from '../../services/compositeService';
import './ResultStep.css';

interface ResultStepProps {
  targetName: string;
  recipeName: string;
  filters: string[];
  /** Object URL for the preview image */
  previewUrl: string | null;
  /** Blob of the generated composite (for download) */
  compositeBlob: Blob | null;
  /** Whether export is in progress */
  isExporting: boolean;
  /** Export error */
  exportError: string | null;
  /** Callback to regenerate with adjusted params */
  onAdjust: (adjustments: { brightness: number; contrast: number; saturation: number }) => void;
}

/**
 * Step 3: Result — shows composite preview with simple adjustments and export.
 */
export function ResultStep({
  targetName,
  recipeName,
  filters,
  previewUrl,
  compositeBlob,
  isExporting,
  exportError,
  onAdjust,
}: ResultStepProps) {
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [saturation, setSaturation] = useState(50);
  const [hasAdjusted, setHasAdjusted] = useState(false);

  function handleApplyAdjustments() {
    setHasAdjusted(true);
    onAdjust({ brightness, contrast, saturation });
  }

  function handleDownload(format: 'png' | 'jpeg') {
    if (!compositeBlob) return;
    const filename = generateFilename(format);
    downloadComposite(compositeBlob, filename);
  }

  return (
    <div className="result-step">
      <div className="result-preview-wrap">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${recipeName} composite of ${targetName}`}
            className="result-preview-image"
          />
        ) : (
          <div className="result-preview-placeholder">
            {isExporting ? 'Generating preview...' : 'No preview available'}
          </div>
        )}
      </div>

      <div className="result-info">
        <h3 className="result-title">
          {targetName} &mdash; {recipeName}
        </h3>
        <p className="result-filters">
          {filters.map((f, i) => (
            <span key={f}>
              {i > 0 && <span className="result-filter-dot"> &middot; </span>}
              <code>{f}</code>
            </span>
          ))}
        </p>
      </div>

      {exportError && <p className="result-export-error">{exportError}</p>}

      <div className="result-adjustments">
        <h4 className="result-adjustments-header">Quick Adjustments</h4>
        <div className="result-slider-group">
          <label className="result-slider-label">
            <span>Brightness</span>
            <input
              type="range"
              min="0"
              max="100"
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="result-slider"
            />
          </label>
          <label className="result-slider-label">
            <span>Contrast</span>
            <input
              type="range"
              min="0"
              max="100"
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
              className="result-slider"
            />
          </label>
          <label className="result-slider-label">
            <span>Saturation</span>
            <input
              type="range"
              min="0"
              max="100"
              value={saturation}
              onChange={(e) => setSaturation(Number(e.target.value))}
              className="result-slider"
            />
          </label>
        </div>
        {(brightness !== 50 || contrast !== 50 || saturation !== 50) && !hasAdjusted && (
          <button
            className="result-apply-btn"
            onClick={handleApplyAdjustments}
            disabled={isExporting}
          >
            {isExporting ? 'Regenerating...' : 'Apply Adjustments'}
          </button>
        )}
        {hasAdjusted && brightness === 50 && contrast === 50 && saturation === 50 && null}
      </div>

      <div className="result-export-actions">
        <button
          className="result-export-btn result-export-primary"
          onClick={() => handleDownload('png')}
          disabled={!compositeBlob || isExporting}
        >
          Download PNG
        </button>
        <button
          className="result-export-btn"
          onClick={() => handleDownload('jpeg')}
          disabled={!compositeBlob || isExporting}
        >
          Download JPEG
        </button>
      </div>

      <div className="result-advanced-link">
        <Link to="/library">Open in Advanced Editor &rarr;</Link>
      </div>
    </div>
  );
}
