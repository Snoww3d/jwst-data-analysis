import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  channelColorToHex,
  hexToRgb,
  rgbToHue,
  hueToHex,
  NASA_PALETTE,
} from '../../utils/wavelengthUtils';
import type { CompositePageState, NChannelConfigPayload } from '../../types/CompositeTypes';
import { COMPOSITE_PRESETS } from '../../types/CompositeTypes';
import { ExportFramingPanel } from './ExportFramingPanel';
import type { ExportFramingResult } from './ExportFramingPanel';
import './ResultStep.css';

interface ResultStepProps {
  targetName: string;
  recipeName: string;
  filters: string[];
  /** Object URL for the preview image */
  previewUrl: string | null;
  /** Whether export is in progress */
  isExporting: boolean;
  /** Export error */
  exportError: string | null;
  /** Callback to regenerate with adjusted params */
  onAdjust: (adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
    featherStrength: number;
  }) => void;
  /** Per-channel payloads for color/weight editing */
  channels: NChannelConfigPayload[];
  /** Callback when channels are modified (color or weight) */
  onChannelsChange: (channels: NChannelConfigPayload[]) => void;
  /** Currently active stretch preset ID */
  activePresetId: string;
  /** Callback when user selects a different stretch preset */
  onPresetChange: (presetId: string) => void;
  /** Callback to export with framing params */
  onExport: (result: ExportFramingResult) => void;
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
  isExporting,
  exportError,
  onAdjust,
  channels,
  onChannelsChange,
  activePresetId,
  onPresetChange,
  onExport,
  compositePageState,
}: ResultStepProps) {
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [saturation, setSaturation] = useState(50);
  const [featherStrength, setFeatherStrength] = useState(15);
  const [rotation, setRotation] = useState(0);

  // Local channel state for immediate UI feedback before debounced regeneration
  const [localChannels, setLocalChannels] = useState<NChannelConfigPayload[] | null>(null);

  // Reset quick adjustment sliders and local channels when preset changes.
  // Setting state in useEffect on prop change is the standard React pattern here —
  // alternatives (key-based remounting) would lose other component state.
  const prevPresetRef = useRef(activePresetId);
  useEffect(() => {
    if (prevPresetRef.current !== activePresetId) {
      prevPresetRef.current = activePresetId;
      /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- intentional reset on prop change; key-based remounting would lose other component state */
      setBrightness(50);
      setContrast(50);
      setSaturation(50);
      setFeatherStrength(15);
      setLocalChannels(null);
      /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
    }
  }, [activePresetId]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adjustDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Debounced auto-apply for quick adjustments (same pattern as channel changes)
  const debouncedAdjust = useCallback(
    (b: number, c: number, s: number, f: number) => {
      if (adjustDebounceRef.current) clearTimeout(adjustDebounceRef.current);
      adjustDebounceRef.current = setTimeout(() => {
        onAdjust({ brightness: b, contrast: c, saturation: s, featherStrength: f / 100 });
        adjustDebounceRef.current = null;
      }, 1000);
    },
    [onAdjust]
  );

  function handleBrightness(value: number) {
    setBrightness(value);
    debouncedAdjust(value, contrast, saturation, featherStrength);
  }

  function handleContrast(value: number) {
    setContrast(value);
    debouncedAdjust(brightness, value, saturation, featherStrength);
  }

  function handleSaturation(value: number) {
    setSaturation(value);
    debouncedAdjust(brightness, contrast, value, featherStrength);
  }

  function handleFeatherStrength(value: number) {
    setFeatherStrength(value);
    debouncedAdjust(brightness, contrast, saturation, value);
  }

  function handleRotate(direction: 1 | -1, degrees: number = 15) {
    setRotation((prev) => {
      const next = prev + direction * degrees;
      // Clamp to -180..180 range (server validates this range)
      return Math.max(-180, Math.min(180, ((next + 540) % 360) - 180));
    });
  }

  return (
    <div className="result-step">
      <div className="result-layout">
        {/* Left: preview image */}
        <div className="result-preview-wrap">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${recipeName} composite of ${targetName}`}
              className="result-preview-image"
              style={rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined}
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

        {/* Right: controls sidebar */}
        <div className="result-sidebar">
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

          <div className="result-presets">
            <h4 className="result-presets-header">Stretch Preset</h4>
            <div className="result-presets-row" role="group" aria-label="Stretch presets">
              {COMPOSITE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`btn-base result-preset-btn${activePresetId === preset.id ? ' active' : ''}`}
                  title={preset.description}
                  aria-pressed={activePresetId === preset.id}
                  disabled={isExporting}
                  onClick={() => onPresetChange(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {displayChannels.length > 0 && (
            <div className="result-channels">
              <h4 className="result-channels-header">Channel Colors</h4>
              <div className="result-channels-list">
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
                          className="btn-base result-channel-swatch-btn"
                          title="Change color"
                          onClick={() => setOpenPickerIndex(openPickerIndex === i ? null : i)}
                        >
                          <span
                            className="result-channel-swatch"
                            style={{ backgroundColor: hex }}
                          />
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
                                    className={`btn-base result-channel-preset${isActive ? ' active' : ''}`}
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
                  onChange={(e) => handleBrightness(Number(e.target.value))}
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
                  onChange={(e) => handleContrast(Number(e.target.value))}
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
                  onChange={(e) => handleSaturation(Number(e.target.value))}
                  className="result-slider"
                />
              </label>
              <label className="result-slider-label">
                <span>Edge Feather</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={featherStrength}
                  onChange={(e) => handleFeatherStrength(Number(e.target.value))}
                  className="result-slider"
                />
              </label>
            </div>
          </div>

          <div className="result-actions result-rotation">
            <div className="result-rotation-controls">
              <button
                type="button"
                className="btn-icon btn-icon-sm result-rotate-btn"
                onClick={(e) => handleRotate(-1, e.shiftKey ? 90 : 15)}
                title="Rotate counter-clockwise (15°, Shift+click for 90°)"
              >
                &#x21ba;
              </button>
              <input
                type="number"
                className="result-rotation-input"
                value={rotation}
                min={-180}
                max={180}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setRotation(Math.max(-180, Math.min(180, val)));
                }}
                title="Enter rotation angle"
                aria-label="Rotation angle in degrees"
              />
              <span className="result-rotation-unit">°</span>
              <button
                type="button"
                className="btn-icon btn-icon-sm result-rotate-btn"
                onClick={(e) => handleRotate(1, e.shiftKey ? 90 : 15)}
                title="Rotate clockwise (15°, Shift+click for 90°)"
              >
                &#x21bb;
              </button>
              {rotation !== 0 && (
                <button
                  type="button"
                  className="btn-base result-rotate-reset"
                  onClick={() => setRotation(0)}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <ExportFramingPanel
            previewUrl={previewUrl}
            rotation={rotation}
            disabled={isExporting}
            onExport={onExport}
          />

          <div className="result-advanced-link">
            <Link to="/composite" state={compositePageState}>
              Open in Advanced Editor &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
