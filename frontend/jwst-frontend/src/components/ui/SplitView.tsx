/**
 * SplitView — JWST Discovery design-system primitive.
 *
 * Two horizontal panes with a draggable divider. The divider is a
 * `role="separator"` with `aria-valuenow` (percent of width given to the
 * primary pane); pointer drag and ←/→ (±2 %), Home/End (min/max) all move it.
 * Below 1024 px the panes stack (primary above secondary) and the divider
 * hides. `collapsed` hides the secondary pane and the divider. The ratio is
 * persisted in localStorage under `storageKey`.
 *
 * Usage:
 *   <SplitView storageKey="mast-search" primary={<ResultsTable/>} secondary={<SkyMap/>} />
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import './SplitView.css';

export const SPLIT_VIEW_DEFAULT_RATIO = 0.55;
export const SPLIT_VIEW_MIN_RATIO = 0.25;
export const SPLIT_VIEW_MAX_RATIO = 0.75;
const KEY_STEP = 0.02;

export interface SplitViewProps {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  /** localStorage key suffix the ratio is persisted under. */
  storageKey: string;
  /** Hide the secondary pane (and the divider). */
  collapsed?: boolean;
  /** Initial ratio when nothing is stored (0–1 share of the primary pane). */
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  /** Accessible name for the divider. */
  label?: string;
  className?: string;
  /** Called after a drag/keyboard change settles with the new ratio. */
  onRatioChange?: (ratio: number) => void;
}

export function splitViewStorageKey(storageKey: string): string {
  return `split_view_ratio:${storageKey}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function loadSplitRatio(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(splitViewStorageKey(storageKey));
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveSplitRatio(storageKey: string, ratio: number): void {
  try {
    localStorage.setItem(splitViewStorageKey(storageKey), ratio.toFixed(4));
  } catch {
    /* a lost ratio is a cosmetic loss */
  }
}

export function SplitView({
  primary,
  secondary,
  storageKey,
  collapsed = false,
  defaultRatio = SPLIT_VIEW_DEFAULT_RATIO,
  minRatio = SPLIT_VIEW_MIN_RATIO,
  maxRatio = SPLIT_VIEW_MAX_RATIO,
  label = 'Resize panes',
  className,
  onRatioChange,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() =>
    clamp(loadSplitRatio(storageKey, defaultRatio), minRatio, maxRatio)
  );
  const [dragging, setDragging] = useState(false);
  const primaryId = useId();
  const secondaryId = useId();

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next, minRatio, maxRatio);
      setRatio(clamped);
      saveSplitRatio(storageKey, clamped);
      onRatioChange?.(clamped);
    },
    [minRatio, maxRatio, storageKey, onRatioChange]
  );

  const ratioFromClientX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return ratio;
      return clamp((clientX - rect.left) / rect.width, minRatio, maxRatio);
    },
    [ratio, minRatio, maxRatio]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setRatio(ratioFromClientX(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    commit(ratioFromClientX(e.clientX));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = ratio - KEY_STEP;
    else if (e.key === 'ArrowRight') next = ratio + KEY_STEP;
    else if (e.key === 'Home') next = minRatio;
    else if (e.key === 'End') next = maxRatio;
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  // While dragging, the text in both panes must not get selected.
  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [dragging]);

  const percent = Math.round(ratio * 100);
  const classes = ['split-view'];
  if (collapsed) classes.push('split-view-collapsed');
  if (dragging) classes.push('split-view-dragging');
  if (className) classes.push(className);

  return (
    <div
      ref={containerRef}
      className={classes.join(' ')}
      style={{ '--split-ratio': `${percent}%` } as React.CSSProperties}
    >
      <div id={primaryId} className="split-view-pane split-view-primary">
        {primary}
      </div>
      {!collapsed && (
        <>
          <div
            className="split-view-divider"
            role="separator"
            aria-label={label}
            aria-orientation="vertical"
            aria-valuemin={Math.round(minRatio * 100)}
            aria-valuemax={Math.round(maxRatio * 100)}
            aria-valuenow={percent}
            aria-controls={`${primaryId} ${secondaryId}`}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            <span className="split-view-grip" aria-hidden="true" />
          </div>
          <div id={secondaryId} className="split-view-pane split-view-secondary">
            {secondary}
          </div>
        </>
      )}
    </div>
  );
}

export default SplitView;
