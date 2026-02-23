import React from 'react';
import type { SmoothMethod, SmoothingParams } from '../../types/AnalysisTypes';

interface SmoothingControlsProps {
  params: SmoothingParams;
  onChange: (params: SmoothingParams) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const SMOOTH_METHOD_OPTIONS: Array<{ value: SmoothMethod; label: string; description: string }> = [
  { value: '', label: 'None', description: 'No smoothing applied' },
  { value: 'gaussian', label: 'Gaussian', description: 'Fast scipy gaussian (propagates NaN)' },
  { value: 'median', label: 'Median', description: 'Good for cosmic ray removal' },
  { value: 'box', label: 'Box', description: 'Simple averaging filter' },
  {
    value: 'astropy_gaussian',
    label: 'Astropy Gaussian',
    description: 'Recommended - handles NaN values',
  },
  { value: 'astropy_box', label: 'Astropy Box', description: 'Box filter with NaN handling' },
];

// SVG Icons (same pattern as StretchControls)
const Icons = {
  Filter: () => (
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
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
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

const DEFAULT_SMOOTHING: SmoothingParams = { method: '', sigma: 1.0, size: 3 };

const SmoothingControls: React.FC<SmoothingControlsProps> = ({
  params,
  onChange,
  collapsed = true,
  onToggleCollapse,
}) => {
  const { method, sigma, size } = params;
  const isGaussian = method === 'gaussian' || method === 'astropy_gaussian';
  const isKernelBased = method === 'median' || method === 'box' || method === 'astropy_box';

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(DEFAULT_SMOOTHING);
  };

  return (
    <div className={`stretch-controls ${collapsed ? 'collapsed' : ''}`}>
      <div className="stretch-controls-header" onClick={onToggleCollapse}>
        <div className="stretch-controls-title">
          <Icons.Filter />
          <span>Smoothing</span>
          {method && (
            <span style={{ fontSize: '10px', opacity: 0.6, marginLeft: '6px' }}>
              ({SMOOTH_METHOD_OPTIONS.find((o) => o.value === method)?.label})
            </span>
          )}
        </div>
        <div className="stretch-controls-actions">
          {method && (
            <button className="btn-icon btn-xs" onClick={handleReset} title="Reset smoothing">
              <Icons.Reset />
            </button>
          )}
          {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
        </div>
      </div>
      {!collapsed && (
        <div className="stretch-controls-body">
          <div className="control-group">
            <label className="control-label">Method</label>
            <select
              value={method}
              onChange={(e) => onChange({ ...params, method: e.target.value as SmoothMethod })}
              className="stretch-select"
            >
              {SMOOTH_METHOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {method && (
              <span className="control-hint">
                {SMOOTH_METHOD_OPTIONS.find((o) => o.value === method)?.description}
              </span>
            )}
          </div>

          {isGaussian && (
            <div className="control-group">
              <div className="control-label-row">
                <label className="control-label">Sigma</label>
                <span className="control-value">{sigma.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5.0}
                step={0.1}
                value={sigma}
                onChange={(e) => onChange({ ...params, sigma: parseFloat(e.target.value) })}
              />
              <div className="slider-labels">
                <span>0.5 (subtle)</span>
                <span>5.0 (heavy)</span>
              </div>
            </div>
          )}

          {isKernelBased && (
            <div className="control-group">
              <div className="control-label-row">
                <label className="control-label">Kernel Size</label>
                <span className="control-value">{size}px</span>
              </div>
              <input
                type="range"
                min={3}
                max={15}
                step={2}
                value={size}
                onChange={(e) => onChange({ ...params, size: parseInt(e.target.value) })}
              />
              <div className="slider-labels">
                <span>3 (subtle)</span>
                <span>15 (heavy)</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SmoothingControls;
