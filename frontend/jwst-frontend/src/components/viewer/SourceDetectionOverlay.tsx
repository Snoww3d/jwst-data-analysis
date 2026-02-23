import React, { useState, useRef, useCallback, type RefCallback } from 'react';
import type { SourceInfo } from '../../types/AnalysisTypes';

interface SourceDetectionOverlayProps {
  sources: SourceInfo[];
  imageElement: HTMLImageElement | null;
  imageDataWidth: number;
  imageDataHeight: number;
  scaleFactor: number;
  visible: boolean;
}

const SourceDetectionOverlay: React.FC<SourceDetectionOverlayProps> = ({
  sources,
  imageElement,
  imageDataWidth,
  imageDataHeight,
  scaleFactor,
  visible,
}) => {
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const svgObserverRef = useRef<ResizeObserver | null>(null);
  const [svgRect, setSvgRect] = useState<DOMRect | null>(null);
  const [hoveredSource, setHoveredSource] = useState<number | null>(null);

  const svgCallbackRef: RefCallback<SVGSVGElement> = useCallback((node: SVGSVGElement | null) => {
    svgNodeRef.current = node;
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

  if (!visible || sources.length === 0 || !imageElement) return null;

  const fitsToScreenCoords = (fitsX: number, fitsY: number): { x: number; y: number } | null => {
    if (!imageElement || !svgRect) return null;
    const imgRect = imageElement.getBoundingClientRect();
    // Source detection coords are in full FITS pixel space (numpy row/col indices);
    // convert to preview space by dividing by scale_factor
    const previewX = fitsX / scaleFactor;
    const previewY = fitsY / scaleFactor;
    // Y-flip needed: matplotlib origin="lower" renders row 0 at bottom of PNG,
    // but screen/PNG y=0 is at top. AnnotationOverlay doesn't flip because its
    // coords are already in PNG pixel space (created from screen clicks).
    const pngY = imageDataHeight - previewY;
    const screenX = (previewX / imageDataWidth) * imgRect.width + imgRect.left - svgRect.left;
    const screenY = (pngY / imageDataHeight) * imgRect.height + imgRect.top - svgRect.top;
    return { x: screenX, y: screenY };
  };

  return (
    <svg
      ref={svgCallbackRef}
      className="source-detection-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {sources.map((source) => {
        const pos = fitsToScreenCoords(source.xcentroid, source.ycentroid);
        if (!pos) return null;
        const isHovered = hoveredSource === source.id;
        const radius = isHovered ? 10 : 7;

        return (
          <g key={source.id}>
            {/* Outer marker circle */}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius}
              fill="none"
              stroke="#00e5ff"
              strokeWidth={isHovered ? 2.5 : 1.5}
              opacity={isHovered ? 1 : 0.8}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredSource(source.id)}
              onMouseLeave={() => setHoveredSource(null)}
            />
            {/* Crosshair lines */}
            <line
              x1={pos.x - radius - 3}
              y1={pos.y}
              x2={pos.x - radius + 1}
              y2={pos.y}
              stroke="#00e5ff"
              strokeWidth={1}
              opacity={0.6}
            />
            <line
              x1={pos.x + radius - 1}
              y1={pos.y}
              x2={pos.x + radius + 3}
              y2={pos.y}
              stroke="#00e5ff"
              strokeWidth={1}
              opacity={0.6}
            />
            <line
              x1={pos.x}
              y1={pos.y - radius - 3}
              x2={pos.x}
              y2={pos.y - radius + 1}
              stroke="#00e5ff"
              strokeWidth={1}
              opacity={0.6}
            />
            <line
              x1={pos.x}
              y1={pos.y + radius - 1}
              x2={pos.x}
              y2={pos.y + radius + 3}
              stroke="#00e5ff"
              strokeWidth={1}
              opacity={0.6}
            />
            {/* Tooltip on hover */}
            {isHovered && (
              <g>
                <rect
                  x={pos.x + 14}
                  y={pos.y - 30}
                  width={160}
                  height={source.flux != null ? 56 : 38}
                  rx={4}
                  fill="rgba(0, 0, 0, 0.85)"
                  stroke="#00e5ff"
                  strokeWidth={0.5}
                />
                <text
                  x={pos.x + 20}
                  y={pos.y - 14}
                  fill="#00e5ff"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  #{source.id} ({source.xcentroid.toFixed(1)}, {source.ycentroid.toFixed(1)})
                </text>
                {source.flux != null && (
                  <text
                    x={pos.x + 20}
                    y={pos.y + 2}
                    fill="#ccc"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    Flux: {source.flux.toExponential(2)}
                  </text>
                )}
                {source.peak != null && (
                  <text
                    x={pos.x + 20}
                    y={pos.y + 16}
                    fill="#ccc"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    Peak: {source.peak.toExponential(2)}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default SourceDetectionOverlay;
