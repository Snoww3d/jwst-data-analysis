import React, { useState } from 'react';
import type { CompositeWarning } from '../types/CompositeTypes';
import './CompositeWarningBanner.css';

interface CompositeWarningBannerProps {
  warning: CompositeWarning | null;
}

/**
 * Banner that surfaces a memory-budget warning emitted by the processing engine.
 *
 * Renders only when the engine actually reduced the output (`wasDownscaled`)
 * or when budget pressure on a cached result would force a reduction
 * (`budgetStatus === 'fail'`). For status="ok" the banner stays hidden — no
 * useful signal to surface.
 *
 * Dismissible: dismissing clears the banner until a *different* warning arrives
 * (e.g. user tweaks parameters, regenerates, hits a fresh budget pressure).
 * Tracks dismissal by warning identity rather than a boolean, so a stricter
 * downscale cannot stay hidden behind an old dismiss.
 */
export const CompositeWarningBanner: React.FC<CompositeWarningBannerProps> = ({ warning }) => {
  // Store the warning object that was dismissed (or null if nothing dismissed).
  // When a new warning arrives, identity differs, banner re-shows automatically
  // — no effect needed, parent passes a fresh object per generate call.
  const [dismissedWarning, setDismissedWarning] = useState<CompositeWarning | null>(null);

  if (!warning) return null;
  if (warning.budgetStatus === 'ok') return null;
  if (dismissedWarning === warning) return null;

  const original = warning.originalShape;
  const output = warning.outputShape;
  const sideFactor = warning.sideFactor;

  const sizeText =
    original && output ? `${output[1]}×${output[0]}px from ${original[1]}×${original[0]}px` : null;
  const reductionText =
    sideFactor !== undefined ? `(${(sideFactor * 100).toFixed(0)}% of original side length)` : null;

  const isFail = warning.budgetStatus === 'fail';

  return (
    <div
      className={`composite-warning-banner${isFail ? ' composite-warning-banner--fail' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="composite-warning-banner__icon" aria-hidden="true">
        ⚠
      </div>
      <div className="composite-warning-banner__body">
        <div className="composite-warning-banner__title">
          {isFail
            ? 'Result served from cache exceeds current memory budget'
            : 'Output reduced to fit memory budget'}
        </div>
        <div className="composite-warning-banner__detail">
          {warning.wasDownscaled && sizeText && <span>{sizeText} </span>}
          {reductionText && <span>{reductionText}</span>}
          {!warning.wasDownscaled && isFail && (
            <span>
              Clear cache (restart processing-engine) or raise{' '}
              <code>MAX_COMPOSITE_MEMORY_BYTES</code> to refresh.
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="composite-warning-banner__dismiss"
        onClick={() => setDismissedWarning(warning)}
        aria-label="Dismiss warning"
      >
        ×
      </button>
    </div>
  );
};

export default CompositeWarningBanner;
