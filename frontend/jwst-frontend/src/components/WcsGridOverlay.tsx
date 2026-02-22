import React, { useMemo, useRef, useCallback, useState, type RefCallback } from 'react';
import './WcsGridOverlay.css';
import { WCSParams } from '../types/JwstDataTypes';
import {
  computeWcsGridLines,
  computeScaleBar,
  WcsGridData,
  WcsGridPoint,
  ScaleBarData,
} from '../utils/wcsGridUtils';

interface WcsGridOverlayProps {
  wcs: WCSParams | null;
  /** Preview image width (pixels) */
  imageWidth: number;
  /** Preview image height (pixels) */
  imageHeight: number;
  /** Ratio of original to preview dimensions */
  scaleFactor: number;
  /** Current displayed image element for coordinate mapping */
  imageElement: HTMLImageElement | null;
  /** Whether the grid overlay is visible */
  visible: boolean;
  /** Current viewer zoom scale (1 = 100%) for scale bar computation */
  zoomScale: number;
}

/**
 * SVG overlay component that renders a WCS coordinate grid over a FITS image.
 * Shows RA/Dec grid lines with edge labels in HMS/DMS format.
 *
 * Follows the same overlay pattern as RegionSelector — positions SVG elements
 * by converting FITS pixel coordinates to screen coordinates using the image
 * element's bounding rect.
 */
const WcsGridOverlay: React.FC<WcsGridOverlayProps> = ({
  wcs,
  imageWidth,
  imageHeight,
  scaleFactor,
  imageElement,
  visible,
  zoomScale,
}) => {
  const svgObserverRef = useRef<ResizeObserver | null>(null);
  const [svgRect, setSvgRect] = useState<DOMRect | null>(null);
  const svgCallbackRef: RefCallback<SVGSVGElement> = useCallback((node: SVGSVGElement | null) => {
    if (node) {
      setSvgRect(node.getBoundingClientRect());
      const observer = new ResizeObserver(() => {
        setSvgRect(node.getBoundingClientRect());
      });
      observer.observe(node);
      svgObserverRef.current = observer;
    } else {
      svgObserverRef.current?.disconnect();
    }
  }, []);

  // Compute grid data — only recomputes when WCS or dimensions change.
  // Does NOT recompute on pan/zoom since grid is in FITS pixel space.
  const gridData: WcsGridData | null = useMemo(() => {
    if (!visible || !wcs || imageWidth <= 0 || imageHeight <= 0) return null;
    return computeWcsGridLines(wcs, imageWidth, imageHeight, scaleFactor);
  }, [visible, wcs, imageWidth, imageHeight, scaleFactor]);

  // Compute scale bar — recomputes on zoom change
  const scaleBarData: ScaleBarData | null = useMemo(() => {
    if (!visible || !wcs) return null;
    return computeScaleBar(wcs, scaleFactor, zoomScale);
  }, [visible, wcs, scaleFactor, zoomScale]);

  // Convert FITS pixel coordinates to screen coordinates for SVG rendering.
  // Uses imageElement.getBoundingClientRect() which reflects current pan/zoom.
  const fitsToScreenCoords = useCallback(
    (fitsX: number, fitsY: number): { x: number; y: number } | null => {
      if (!imageElement || !svgRect) return null;

      const imgRect = imageElement.getBoundingClientRect();

      // Map from FITS original-resolution coords to preview-resolution coords
      const previewX = fitsX / scaleFactor;
      const previewY = fitsY / scaleFactor;

      // Convert from FITS Y (origin bottom-left) to image Y (origin top-left)
      const imageY = imageHeight - previewY;

      // Map from preview pixel coords to rendered screen coords
      const screenX = (previewX / imageWidth) * imgRect.width + imgRect.left - svgRect.left;
      const screenY = (imageY / imageHeight) * imgRect.height + imgRect.top - svgRect.top;

      return { x: screenX, y: screenY };
    },
    [imageElement, imageWidth, imageHeight, scaleFactor, svgRect]
  );

  // Build an SVG path string from a polyline of FITS pixel coordinates
  const buildPathString = useCallback(
    (points: WcsGridPoint[]): string | null => {
      const screenPoints: Array<{ x: number; y: number }> = [];

      for (const p of points) {
        const screen = fitsToScreenCoords(p.x, p.y);
        if (screen) {
          screenPoints.push(screen);
        }
      }

      if (screenPoints.length < 2) return null;

      let d = `M ${screenPoints[0].x.toFixed(1)},${screenPoints[0].y.toFixed(1)}`;
      for (let i = 1; i < screenPoints.length; i++) {
        d += ` L ${screenPoints[i].x.toFixed(1)},${screenPoints[i].y.toFixed(1)}`;
      }

      return d;
    },
    [fitsToScreenCoords]
  );

  if (!visible || (!gridData && !scaleBarData)) return null;

  // Label dimensions for background rect
  const labelPadX = 3;
  const labelPadY = 2;
  const labelFontSize = 10;

  return (
    <>
      <svg ref={svgCallbackRef} className="wcs-grid-overlay">
        {/* Constant-Dec lines (roughly horizontal) */}
        {gridData?.decLines.map((line) => {
          const d = buildPathString(line.points);
          if (!d) return null;
          return <path key={`dec-${line.value}`} d={d} className="wcs-grid-line" />;
        })}

        {/* Constant-RA lines (roughly vertical) */}
        {gridData?.raLines.map((line) => {
          const d = buildPathString(line.points);
          if (!d) return null;
          return <path key={`ra-${line.value}`} d={d} className="wcs-grid-line" />;
        })}

        {/* Dec labels (left edge) */}
        {gridData?.decLabels.map((label) => {
          const screen = fitsToScreenCoords(label.x, label.y);
          if (!screen) return null;

          const textWidth = label.formattedValue.length * 6.5;
          const bgWidth = textWidth + labelPadX * 2;
          const bgHeight = labelFontSize + labelPadY * 2;

          // Position label just inside the left edge
          const anchorX = Math.max(screen.x + 4, 2);
          const anchorY = screen.y;

          return (
            <g key={`dec-label-${label.value}`}>
              <rect
                x={anchorX - labelPadX}
                y={anchorY - bgHeight / 2}
                width={bgWidth}
                height={bgHeight}
                className="wcs-grid-label-bg"
              />
              <text
                x={anchorX + textWidth / 2}
                y={anchorY}
                textAnchor="middle"
                className="wcs-grid-label-text"
              >
                {label.formattedValue}
              </text>
            </g>
          );
        })}

        {/* RA labels (bottom edge) */}
        {gridData?.raLabels.map((label) => {
          const screen = fitsToScreenCoords(label.x, label.y);
          if (!screen) return null;

          const textWidth = label.formattedValue.length * 6.5;
          const bgWidth = textWidth + labelPadX * 2;
          const bgHeight = labelFontSize + labelPadY * 2;

          // Position label just inside the bottom edge
          const anchorX = screen.x;
          const anchorY = Math.min(screen.y - 4, screen.y);

          return (
            <g key={`ra-label-${label.value}`}>
              <rect
                x={anchorX - bgWidth / 2}
                y={anchorY - bgHeight / 2}
                width={bgWidth}
                height={bgHeight}
                className="wcs-grid-label-bg"
              />
              <text x={anchorX} y={anchorY} textAnchor="middle" className="wcs-grid-label-text">
                {label.formattedValue}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Angular scale bar — viewport-fixed in lower-right corner */}
      {scaleBarData && (
        <div className="wcs-scale-bar">
          <div className="wcs-scale-bar-label">{scaleBarData.label}</div>
          <div className="wcs-scale-bar-line" style={{ width: scaleBarData.widthPx }}>
            <div className="wcs-scale-bar-tick wcs-scale-bar-tick-left" />
            <div className="wcs-scale-bar-tick wcs-scale-bar-tick-right" />
          </div>
        </div>
      )}
    </>
  );
};

export default WcsGridOverlay;
