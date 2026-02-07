import React, { useState, useCallback, useRef, useEffect } from 'react';
import './RegionSelector.css';
import type { RegionType, RectangleRegion, EllipseRegion } from '../types/AnalysisTypes';

interface RegionSelectorProps {
  mode: RegionType | null;
  onRegionComplete: (
    regionType: RegionType,
    rectangle?: RectangleRegion,
    ellipse?: EllipseRegion
  ) => void;
  onClear: () => void;
  /** Pixel dimensions of the actual FITS image data (for coordinate mapping) */
  imageDataWidth: number;
  imageDataHeight: number;
  /** Current displayed image element for coordinate mapping */
  imageElement: HTMLImageElement | null;
  /** Current zoom scale (reserved for future use) */
  scale?: number;
  /** Current pan offset (reserved for future use) */
  offset?: { x: number; y: number };
}

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  drawing: boolean;
}

/**
 * SVG overlay component for interactive region selection on FITS images.
 * Supports rectangle and ellipse drawing modes.
 */
const RegionSelector: React.FC<RegionSelectorProps> = ({
  mode,
  onRegionComplete,
  // onClear is passed down but used by parent to reset state
  onClear: _onClear,
  imageDataWidth,
  imageDataHeight,
  imageElement,
}) => {
  void _onClear;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [completedRegion, setCompletedRegion] = useState<{
    type: RegionType;
    rect?: { x: number; y: number; w: number; h: number };
    ellipse?: { cx: number; cy: number; rx: number; ry: number };
  } | null>(null);

  // Convert screen coordinates to FITS pixel coordinates
  const screenToFitsCoords = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } | null => {
      if (!imageElement) return null;

      const imgRect = imageElement.getBoundingClientRect();
      // Position relative to the displayed image
      const relX = screenX - imgRect.left;
      const relY = screenY - imgRect.top;

      // Convert to FITS pixel coordinates
      const fitsX = Math.round((relX / imgRect.width) * imageDataWidth);
      // FITS Y is flipped (origin at bottom-left), but the image is already flipped by matplotlib
      const fitsY = Math.round((relY / imgRect.height) * imageDataHeight);

      return { x: fitsX, y: fitsY };
    },
    [imageElement, imageDataWidth, imageDataHeight]
  );

  // Convert FITS pixel coordinates to screen coordinates for display
  const fitsToScreenCoords = useCallback(
    (fitsX: number, fitsY: number): { x: number; y: number } | null => {
      if (!imageElement || !svgRef.current) return null;

      const imgRect = imageElement.getBoundingClientRect();
      const svgRect = svgRef.current.getBoundingClientRect();

      const screenX = (fitsX / imageDataWidth) * imgRect.width + imgRect.left - svgRect.left;
      const screenY = (fitsY / imageDataHeight) * imgRect.height + imgRect.top - svgRect.top;

      return { x: screenX, y: screenY };
    },
    [imageElement, imageDataWidth, imageDataHeight]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      setCompletedRegion(null);
      setDrawState({
        startX: fits.x,
        startY: fits.y,
        currentX: fits.x,
        currentY: fits.y,
        drawing: true,
      });
    },
    [mode, screenToFitsCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawState?.drawing) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      setDrawState((prev) => (prev ? { ...prev, currentX: fits.x, currentY: fits.y } : null));
    },
    [drawState, screenToFitsCoords]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawState?.drawing || !mode) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      const x0 = Math.min(drawState.startX, fits.x);
      const y0 = Math.min(drawState.startY, fits.y);
      const x1 = Math.max(drawState.startX, fits.x);
      const y1 = Math.max(drawState.startY, fits.y);
      const w = x1 - x0;
      const h = y1 - y0;

      // Minimum region size: 3 pixels
      if (w < 3 || h < 3) {
        setDrawState(null);
        return;
      }

      if (mode === 'rectangle') {
        const rect = { x: x0, y: y0, width: w, height: h };
        setCompletedRegion({ type: 'rectangle', rect: { x: x0, y: y0, w, h } });
        onRegionComplete('rectangle', rect);
      } else {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const rx = w / 2;
        const ry = h / 2;
        const ellipse = { centerX: cx, centerY: cy, radiusX: rx, radiusY: ry };
        setCompletedRegion({ type: 'ellipse', ellipse: { cx, cy, rx, ry } });
        onRegionComplete('ellipse', undefined, ellipse);
      }

      setDrawState(null);
    },
    [drawState, mode, screenToFitsCoords, onRegionComplete]
  );

  // Clear completed region when mode changes or clear is called
  useEffect(() => {
    setCompletedRegion(null);
    setDrawState(null);
  }, [mode]);

  // Render the current drawing or completed region as SVG
  const renderDrawingRegion = () => {
    if (!drawState?.drawing) return null;

    const start = fitsToScreenCoords(drawState.startX, drawState.startY);
    const end = fitsToScreenCoords(drawState.currentX, drawState.currentY);
    if (!start || !end) return null;

    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);

    if (mode === 'rectangle') {
      return <rect x={x} y={y} width={w} height={h} className="region-shape region-drawing" />;
    } else {
      return (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          className="region-shape region-drawing"
        />
      );
    }
  };

  const renderCompletedRegion = () => {
    if (!completedRegion) return null;

    if (completedRegion.type === 'rectangle' && completedRegion.rect) {
      const { x, y, w, h } = completedRegion.rect;
      const topLeft = fitsToScreenCoords(x, y);
      const bottomRight = fitsToScreenCoords(x + w, y + h);
      if (!topLeft || !bottomRight) return null;

      return (
        <rect
          x={topLeft.x}
          y={topLeft.y}
          width={bottomRight.x - topLeft.x}
          height={bottomRight.y - topLeft.y}
          className="region-shape region-completed"
        />
      );
    }

    if (completedRegion.type === 'ellipse' && completedRegion.ellipse) {
      const { cx, cy, rx, ry } = completedRegion.ellipse;
      const center = fitsToScreenCoords(cx, cy);
      const edge = fitsToScreenCoords(cx + rx, cy + ry);
      if (!center || !edge) return null;

      return (
        <ellipse
          cx={center.x}
          cy={center.y}
          rx={Math.abs(edge.x - center.x)}
          ry={Math.abs(edge.y - center.y)}
          className="region-shape region-completed"
        />
      );
    }

    return null;
  };

  if (!mode && !completedRegion) return null;

  return (
    <svg
      ref={svgRef}
      className="region-selector-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: mode ? 'crosshair' : 'default' }}
    >
      {renderDrawingRegion()}
      {renderCompletedRegion()}
    </svg>
  );
};

export default RegionSelector;
