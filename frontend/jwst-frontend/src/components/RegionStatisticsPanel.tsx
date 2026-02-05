import React from 'react';
import './RegionStatisticsPanel.css';
import type { RegionStatisticsResponse } from '../types/AnalysisTypes';

interface RegionStatisticsPanelProps {
  stats: RegionStatisticsResponse | null;
  loading: boolean;
  error: string | null;
  onClear: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function formatStatValue(value: number): string {
  if (Math.abs(value) < 0.001 || Math.abs(value) > 999999) {
    return value.toExponential(4);
  }
  return value.toFixed(4);
}

const RegionStatisticsPanel: React.FC<RegionStatisticsPanelProps> = ({
  stats,
  loading,
  error,
  onClear,
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <div className="region-stats-panel">
      <div className="region-stats-header" onClick={onToggleCollapse}>
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`}>&#9660;</span>
        <h4>Region Statistics</h4>
        <button
          className="region-stats-clear"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title="Clear region"
        >
          &times;
        </button>
      </div>

      {!collapsed && (
        <div className="region-stats-body">
          {loading && (
            <div className="region-stats-loading">
              <div className="mini-spinner"></div>
              <span>Computing...</span>
            </div>
          )}

          {error && <div className="region-stats-error">{error}</div>}

          {stats && !loading && (
            <div className="region-stats-grid">
              <div className="stat-row">
                <span className="stat-label">Pixels</span>
                <span className="stat-value">{stats.pixelCount.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Mean</span>
                <span className="stat-value">{formatStatValue(stats.mean)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Median</span>
                <span className="stat-value">{formatStatValue(stats.median)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Std Dev</span>
                <span className="stat-value">{formatStatValue(stats.std)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Min</span>
                <span className="stat-value">{formatStatValue(stats.min)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Max</span>
                <span className="stat-value">{formatStatValue(stats.max)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Sum</span>
                <span className="stat-value">{formatStatValue(stats.sum)}</span>
              </div>
            </div>
          )}

          {!stats && !loading && !error && (
            <div className="region-stats-empty">Draw a region on the image</div>
          )}
        </div>
      )}
    </div>
  );
};

export default RegionStatisticsPanel;
