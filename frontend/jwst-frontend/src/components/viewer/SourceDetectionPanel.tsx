import React, { useState } from 'react';
import type { SourceDetectionResponse } from '../../types/AnalysisTypes';

interface SourceDetectionPanelProps {
  dataId: string;
  onDetect: (thresholdSigma: number, method: string) => Promise<void>;
  result: SourceDetectionResponse | null;
  loading: boolean;
  error: string | null;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  onClear: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Icons = {
  Search: () => (
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
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
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
};

const SourceDetectionPanel: React.FC<SourceDetectionPanelProps> = ({
  onDetect,
  result,
  loading,
  error,
  showOverlay,
  onToggleOverlay,
  onClear,
  collapsed = true,
  onToggleCollapse,
}) => {
  const [thresholdSigma, setThresholdSigma] = useState<number>(5.0);
  const [method, setMethod] = useState<string>('auto');

  const handleDetect = () => {
    onDetect(thresholdSigma, method);
  };

  return (
    <div className={`stretch-controls ${collapsed ? 'collapsed' : ''}`}>
      <div className="stretch-controls-header" onClick={onToggleCollapse}>
        <div className="stretch-controls-title">
          <Icons.Search />
          <span>Source Detection</span>
          {result && (
            <span style={{ fontSize: '10px', opacity: 0.6, marginLeft: '6px' }}>
              ({result.nSources})
            </span>
          )}
        </div>
        <div className="stretch-controls-actions">
          {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
        </div>
      </div>
      {!collapsed && (
        <div className="stretch-controls-body">
          <div className="control-group">
            <div className="control-label-row">
              <label className="control-label">Threshold (sigma)</label>
              <span className="control-value">{thresholdSigma.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={1.0}
              max={10.0}
              step={0.5}
              value={thresholdSigma}
              onChange={(e) => setThresholdSigma(parseFloat(e.target.value))}
            />
            <div className="slider-labels">
              <span>1.0 (more sources)</span>
              <span>10.0 (fewer sources)</span>
            </div>
          </div>

          <div className="control-group">
            <label className="control-label">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="stretch-select"
            >
              <option value="auto">Auto (recommended)</option>
              <option value="daofind">DAOFind (point sources)</option>
              <option value="iraf">IRAF (point sources)</option>
              <option value="segmentation">Segmentation (extended)</option>
            </select>
          </div>

          <div className="control-group" style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-primary btn-sm"
              onClick={handleDetect}
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? (
                <>
                  <span className="mini-spinner" style={{ marginRight: '6px' }}></span>
                  Detecting...
                </>
              ) : (
                'Detect Sources'
              )}
            </button>
            {result && (
              <button className="btn-secondary btn-sm" onClick={onClear} title="Clear results">
                Clear
              </button>
            )}
          </div>

          {error && (
            <div className="control-group" style={{ color: '#ff6b6b', fontSize: '12px' }}>
              {error}
            </div>
          )}

          {result && (
            <div className="control-group">
              <div
                style={{
                  fontSize: '12px',
                  color: '#b0b0b0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}
              >
                <span>
                  Found <strong style={{ color: '#00e5ff' }}>{result.nSources}</strong> sources
                </span>
                <span style={{ opacity: 0.7 }}>via {result.method}</span>
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: '#b0b0b0',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={showOverlay} onChange={onToggleOverlay} />
                Show markers on image
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SourceDetectionPanel;
