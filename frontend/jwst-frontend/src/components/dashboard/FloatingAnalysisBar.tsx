import React from 'react';
import './FloatingAnalysisBar.css';

interface FloatingAnalysisBarProps {
  visible: boolean;
  selectedCount: number;
  onOpenCompositeWizard: () => void;
  onOpenMosaicWizard: () => void;
  onOpenComparisonPicker: () => void;
}

const FloatingAnalysisBar: React.FC<FloatingAnalysisBarProps> = ({
  visible,
  selectedCount,
  onOpenCompositeWizard,
  onOpenMosaicWizard,
  onOpenComparisonPicker,
}) => {
  return (
    <div className={`floating-analysis-bar ${visible ? 'visible' : ''}`}>
      <div className="floating-analysis-inner">
        <button
          className={`composite-btn ${selectedCount >= 3 ? 'ready' : ''}`}
          onClick={onOpenCompositeWizard}
          title="Create composite image"
        >
          <span className="composite-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="8" r="4" fill="#ff4444" opacity="0.8" />
              <circle cx="16" cy="8" r="4" fill="#44ff44" opacity="0.8" />
              <circle cx="12" cy="14" r="4" fill="#4488ff" opacity="0.8" />
            </svg>
          </span>
          Composite{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
        <button
          className={`mosaic-open-btn ${selectedCount >= 2 ? 'ready' : ''}`}
          onClick={onOpenMosaicWizard}
          title="Create a WCS-aligned mosaic from multiple FITS images"
        >
          <span className="mosaic-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#4488ff" />
              <rect x="13" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#44ddff" />
              <rect x="2" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#8844ff" />
              <rect x="13" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#44ff88" />
            </svg>
          </span>
          WCS Mosaic{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
        <button
          className="compare-open-btn"
          onClick={onOpenComparisonPicker}
          title="Compare two FITS images (blink, side-by-side, or overlay)"
        >
          <span className="compare-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="3" width="8" height="18" rx="1" />
              <rect x="14" y="3" width="8" height="18" rx="1" />
            </svg>
          </span>
          Compare
        </button>
      </div>
    </div>
  );
};

export default FloatingAnalysisBar;
