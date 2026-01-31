import React from 'react';
import './StretchControls.css';

export interface StretchParams {
  stretch: string;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  asinhA: number;
}

interface StretchControlsProps {
  params: StretchParams;
  onChange: (params: StretchParams) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const STRETCH_OPTIONS = [
  { value: 'zscale', label: 'ZScale', description: 'Automatic robust scaling (default)' },
  { value: 'asinh', label: 'Asinh', description: 'High dynamic range, preserves faint detail' },
  { value: 'log', label: 'Logarithmic', description: 'Extended emission, nebulae' },
  { value: 'sqrt', label: 'Square Root', description: 'Moderate compression' },
  { value: 'power', label: 'Power Law', description: 'Customizable with gamma' },
  { value: 'histeq', label: 'Histogram Eq.', description: 'Maximum contrast' },
  { value: 'linear', label: 'Linear', description: 'No compression' },
];

// SVG Icons
const Icons = {
  Sliders: () => (
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
      <line x1="4" y1="21" x2="4" y2="14"></line>
      <line x1="4" y1="10" x2="4" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12" y2="3"></line>
      <line x1="20" y1="21" x2="20" y2="16"></line>
      <line x1="20" y1="12" x2="20" y2="3"></line>
      <line x1="1" y1="14" x2="7" y2="14"></line>
      <line x1="9" y1="8" x2="15" y2="8"></line>
      <line x1="17" y1="16" x2="23" y2="16"></line>
    </svg>
  ),
  ChevronDown: () => (
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
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  ),
  ChevronUp: () => (
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
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
  ),
  Reset: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 4 1 10 7 10"></polyline>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
    </svg>
  ),
};

const StretchControls: React.FC<StretchControlsProps> = ({
  params,
  onChange,
  collapsed = false,
  onToggleCollapse,
}) => {
  const { stretch, gamma, blackPoint, whitePoint, asinhA } = params;

  const handleStretchChange = (newStretch: string) => {
    onChange({ ...params, stretch: newStretch });
  };

  const handleGammaChange = (value: number) => {
    onChange({ ...params, gamma: value });
  };

  const handleBlackPointChange = (value: number) => {
    // Ensure black point stays below white point
    onChange({ ...params, blackPoint: Math.min(value, whitePoint - 0.01) });
  };

  const handleWhitePointChange = (value: number) => {
    // Ensure white point stays above black point
    onChange({ ...params, whitePoint: Math.max(value, blackPoint + 0.01) });
  };

  const handleAsinhAChange = (value: number) => {
    onChange({ ...params, asinhA: value });
  };

  const handleReset = () => {
    onChange({
      stretch: 'zscale',
      gamma: 1.0,
      blackPoint: 0.0,
      whitePoint: 1.0,
      asinhA: 0.1,
    });
  };

  const currentStretchOption = STRETCH_OPTIONS.find((opt) => opt.value === stretch);

  return (
    <div className={`stretch-controls ${collapsed ? 'collapsed' : ''}`}>
      <div className="stretch-controls-header" onClick={onToggleCollapse}>
        <div className="stretch-header-left">
          <Icons.Sliders />
          <span className="stretch-title">Levels</span>
        </div>
        <div className="stretch-header-right">
          {!collapsed && (
            <button
              className="btn-reset"
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              title="Reset to defaults"
            >
              <Icons.Reset />
            </button>
          )}
          {onToggleCollapse && (
            <span className="collapse-icon">
              {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="stretch-controls-body">
          {/* Stretch Algorithm Selector */}
          <div className="control-group">
            <label className="control-label">Stretch Function</label>
            <select
              value={stretch}
              onChange={(e) => handleStretchChange(e.target.value)}
              className="stretch-select"
              title={currentStretchOption?.description}
            >
              {STRETCH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="control-hint">{currentStretchOption?.description}</span>
          </div>

          {/* Gamma Slider */}
          <div className="control-group">
            <div className="control-label-row">
              <label className="control-label">Gamma</label>
              <span className="control-value">{gamma.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5.0"
              step="0.05"
              value={gamma}
              onChange={(e) => handleGammaChange(parseFloat(e.target.value))}
              className="stretch-slider"
            />
            <div className="slider-labels">
              <span>Darker</span>
              <span>Brighter</span>
            </div>
          </div>

          {/* Black Point Slider */}
          <div className="control-group">
            <div className="control-label-row">
              <label className="control-label">Black Point</label>
              <span className="control-value">{(blackPoint * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.99"
              step="0.001"
              value={blackPoint}
              onChange={(e) => handleBlackPointChange(parseFloat(e.target.value))}
              className="stretch-slider"
            />
          </div>

          {/* White Point Slider */}
          <div className="control-group">
            <div className="control-label-row">
              <label className="control-label">White Point</label>
              <span className="control-value">{(whitePoint * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.01"
              max="1.0"
              step="0.001"
              value={whitePoint}
              onChange={(e) => handleWhitePointChange(parseFloat(e.target.value))}
              className="stretch-slider"
            />
          </div>

          {/* Asinh Softening (only visible when asinh stretch selected) */}
          {stretch === 'asinh' && (
            <div className="control-group">
              <div className="control-label-row">
                <label className="control-label">Asinh Softening</label>
                <span className="control-value">{asinhA.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.001"
                max="1.0"
                step="0.001"
                value={asinhA}
                onChange={(e) => handleAsinhAChange(parseFloat(e.target.value))}
                className="stretch-slider"
              />
              <div className="slider-labels">
                <span>More compression</span>
                <span>More linear</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StretchControls;
