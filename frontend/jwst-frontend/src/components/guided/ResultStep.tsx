import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { downloadComposite, generateFilename } from '../../services/compositeService';
import {
  channelColorToHex,
  hexToRgb,
  rgbToHue,
  hueToHex,
  NASA_PALETTE,
} from '../../utils/wavelengthUtils';
import type { CompositePageState, NChannelConfigPayload } from '../../types/CompositeTypes';
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
  /** Per-channel payloads for color/weight editing */
  channels: NChannelConfigPayload[];
  /** Callback when channels are modified (color or weight) */
  onChannelsChange: (channels: NChannelConfigPayload[]) => void;
  /** State to pass to the Composite Creator page */
  compositePageState?: CompositePageState;
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
  channels,
  onChannelsChange,
  compositePageState,
}: ResultStepProps) {
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [saturation, setSaturation] = useState(50);
  const [appliedValues, setAppliedValues] = useState<{
    brightness: number;
    contrast: number;
    saturation: number;
  } | null>(null);

  // Local channel state for immediate UI feedback before debounced regeneration
  const [localChannels, setLocalChannels] = useState<NChannelConfigPayload[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use local channels if user has made edits, otherwise parent channels
  const displayChannels = localChannels ?? channels;

  const debouncedApply = useCallback(
    (updated: NChannelConfigPayload[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChannelsChange(updated);
        debounceRef.current = null;
      }, 1000);
    },
    [onChannelsChange]
  );

  // Color picker popover state
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as HTMLElement)) {
        setOpenPickerIndex(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenPickerIndex(null);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  function handlePresetSelect(index: number, hue: number) {
    const updated = displayChannels.map((ch, i) => (i === index ? { ...ch, color: { hue } } : ch));
    setLocalChannels(updated);
    setOpenPickerIndex(null);
    debouncedApply(updated);
  }

  function handleChannelColorChange(index: number, hex: string) {
    const [r, g, b] = hexToRgb(hex);
    const hue = rgbToHue(r, g, b);
    const updated = displayChannels.map((ch, i) => (i === index ? { ...ch, color: { hue } } : ch));
    setLocalChannels(updated);
    debouncedApply(updated);
  }

  function handleChannelWeightChange(index: number, weight: number) {
    const updated = displayChannels.map((ch, i) => (i === index ? { ...ch, weight } : ch));
    setLocalChannels(updated);
    debouncedApply(updated);
  }

  const slidersChanged = brightness !== 50 || contrast !== 50 || saturation !== 50;
  const slidersMatchApplied =
    appliedValues != null &&
    brightness === appliedValues.brightness &&
    contrast === appliedValues.contrast &&
    saturation === appliedValues.saturation;
  const showApplyBtn = slidersChanged && !slidersMatchApplied;

  function handleApplyAdjustments() {
    setAppliedValues({ brightness, contrast, saturation });
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
        ) : isExporting ? (
          <div className="result-preview-skeleton" />
        ) : (
          <div className="result-preview-placeholder">No preview available</div>
        )}
        {isExporting && previewUrl && (
          <div className="result-regenerating-overlay">Regenerating...</div>
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

      {displayChannels.length > 0 && (
        <div className="result-channels">
          <h4 className="result-channels-header">Channel Colors</h4>
          {displayChannels.map((ch, i) => {
            const hex = channelColorToHex(ch.color);
            const weightPercent = Math.round(ch.weight * 100);
            const currentHue = ch.color.hue ?? (ch.color.rgb ? rgbToHue(...ch.color.rgb) : 0);
            return (
              <div key={ch.label ?? i} className="result-channel-row">
                <div
                  className="result-channel-picker-wrap"
                  ref={openPickerIndex === i ? pickerRef : undefined}
                >
                  <button
                    type="button"
                    className="result-channel-swatch-btn"
                    title="Change color"
                    onClick={() => setOpenPickerIndex(openPickerIndex === i ? null : i)}
                  >
                    <span className="result-channel-swatch" style={{ backgroundColor: hex }} />
                  </button>
                  {openPickerIndex === i && (
                    <div className="result-channel-picker-popover">
                      <div className="result-channel-preset-row">
                        {NASA_PALETTE.map((preset) => {
                          const presetHex = hueToHex(preset.hue);
                          const isActive = Math.abs(currentHue - preset.hue) < 5;
                          return (
                            <button
                              key={preset.name}
                              type="button"
                              className={`result-channel-preset${isActive ? ' active' : ''}`}
                              style={{ backgroundColor: presetHex }}
                              title={preset.name}
                              onClick={() => handlePresetSelect(i, preset.hue)}
                            />
                          );
                        })}
                      </div>
                      <div className="result-channel-picker-divider" />
                      <label className="result-channel-custom-row">
                        <span className="result-channel-custom-label">Custom</span>
                        <span
                          className="result-channel-custom-swatch"
                          style={{ backgroundColor: hex }}
                        />
                        <input
                          type="color"
                          value={hex}
                          onChange={(e) => {
                            handleChannelColorChange(i, e.target.value);
                            setOpenPickerIndex(null);
                          }}
                          className="result-channel-color-input"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <span className="result-channel-name">{ch.label}</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={weightPercent}
                  onChange={(e) => handleChannelWeightChange(i, Number(e.target.value) / 100)}
                  className="result-slider result-channel-slider"
                />
                <span className="result-channel-weight-value">{weightPercent}%</span>
              </div>
            );
          })}
        </div>
      )}

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
        {showApplyBtn && (
          <button
            className="result-apply-btn"
            onClick={handleApplyAdjustments}
            disabled={isExporting}
          >
            {isExporting ? 'Regenerating...' : 'Apply Adjustments'}
          </button>
        )}
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
        <Link to="/composite" state={compositePageState}>
          Open in Advanced Editor &rarr;
        </Link>
      </div>
    </div>
  );
}
