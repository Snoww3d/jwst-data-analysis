import React, { useRef, useEffect, useState, useCallback } from 'react';
import './HistogramPanel.css';

export interface HistogramData {
  counts: number[];
  bin_centers: number[];
  bin_edges: number[];
  n_bins: number;
}

export interface PercentileData {
  [key: string]: number;
}

export interface HistogramStats {
  min: number;
  max: number;
  mean: number;
  std: number;
}

interface HistogramPanelProps {
  histogram: HistogramData | null;
  percentiles?: PercentileData | null;
  stats?: HistogramStats | null;
  blackPoint?: number; // 0.0 to 1.0
  whitePoint?: number; // 0.0 to 1.0
  onBlackPointChange?: (value: number) => void;
  onWhitePointChange?: (value: number) => void;
  onDragEnd?: () => void; // Called when drag ends (for cleanup)
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  title?: string; // Panel title (default: "Histogram")
  showControls?: boolean; // Whether to show black/white point controls (default: true)
  barColor?: string; // Color for histogram bars (default: '#4cc9f0')
  viewDomain?: { min: number; max: number }; // Optional custom view domain (default: 0 to 1)
}

// SVG Icons
const Icons = {
  Chart: () => (
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
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
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

// Constants moved outside component for React hooks exhaustive-deps compliance
const CANVAS_HEIGHT = 100;
const MARGIN = { top: 5, right: 10, bottom: 20, left: 10 };

const HistogramPanel: React.FC<HistogramPanelProps> = ({
  histogram,
  percentiles,
  stats,
  blackPoint = 0,
  whitePoint = 1,
  onBlackPointChange,
  onWhitePointChange,
  onDragEnd,
  loading = false,
  collapsed = false,
  onToggleCollapse,
  title = 'Histogram',
  showControls = true,
  barColor = '#4cc9f0',
  viewDomain = { min: 0, max: 1 },
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'black' | 'white' | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(300);

  // Resize observer for responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width - 20; // Account for padding
        setCanvasWidth(Math.max(200, width));
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Convert pixel position to value within viewDomain
  const pixelToValue = useCallback(
    (pixelX: number): number => {
      const plotWidth = canvasWidth - MARGIN.left - MARGIN.right;
      // Clamp pixel to plot area
      const relativeX = Math.max(0, Math.min(plotWidth, pixelX - MARGIN.left));
      const ratio = relativeX / plotWidth;

      const domainRange = viewDomain.max - viewDomain.min;
      return viewDomain.min + ratio * domainRange;
    },
    [canvasWidth, viewDomain]
  );

  // Convert value to pixel position based on viewDomain
  const valueToPixel = useCallback(
    (value: number): number => {
      const plotWidth = canvasWidth - MARGIN.left - MARGIN.right;
      const domainRange = viewDomain.max - viewDomain.min;

      // Prevent divide by zero
      if (domainRange === 0) return MARGIN.left;

      const ratio = (value - viewDomain.min) / domainRange;
      return MARGIN.left + ratio * plotWidth;
    },
    [canvasWidth, viewDomain]
  );

  // Draw the histogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !histogram || collapsed) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvasWidth;
    const height = CANVAS_HEIGHT;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Draw plot area background
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(MARGIN.left, MARGIN.top, plotWidth, plotHeight);

    const counts = histogram.counts;
    if (!counts || counts.length === 0) return;

    // Use log scale for better visualization of astronomical data
    const logCounts = counts.map((c) => (c > 0 ? Math.log10(c + 1) : 0));
    const maxLogCount = Math.max(...logCounts);

    if (maxLogCount === 0) return;

    // Draw clipped regions (dark areas outside black/white points) - only if controls shown
    if (showControls) {
      const blackPixel = valueToPixel(blackPoint);
      const whitePixel = valueToPixel(whitePoint);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(MARGIN.left, MARGIN.top, blackPixel - MARGIN.left, plotHeight);
      ctx.fillRect(whitePixel, MARGIN.top, width - MARGIN.right - whitePixel, plotHeight);
    }

    // Draw histogram bars
    ctx.fillStyle = barColor;

    // Calculate bin width in pixel space
    // Since we're rendering a subset (viewDomain), we need to project bins correctly

    for (let i = 0; i < counts.length; i++) {
      const barHeight = (logCounts[i] / maxLogCount) * plotHeight;

      // Calculate the value range covered by this bin
      const binStartValue = i / counts.length;
      const binEndValue = (i + 1) / counts.length;

      // Skip if bin is completely outside viewDomain
      if (binEndValue < viewDomain.min || binStartValue > viewDomain.max) continue;

      // Calculate pixel positions for this bin based on viewDomain
      const xStart = valueToPixel(Math.max(binStartValue, viewDomain.min));
      const xEnd = valueToPixel(Math.min(binEndValue, viewDomain.max));
      const width = Math.max(1, xEnd - xStart);

      const y = MARGIN.top + plotHeight - barHeight;

      // Only draw if within bounds and has width
      if (width > 0) {
        ctx.fillRect(xStart, y, width, barHeight);
      }
    }

    // Draw percentile markers (subtle tick marks at bottom)
    if (percentiles) {
      const markerPercentiles = ['p_1', 'p_5', 'p_50', 'p_95', 'p_99'];
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;

      for (const key of markerPercentiles) {
        if (percentiles[key] !== undefined && stats) {
          const range = stats.max - stats.min;
          if (range > 0) {
            const normalizedValue = (percentiles[key] - stats.min) / range;
            // Only draw if within view
            if (normalizedValue >= viewDomain.min && normalizedValue <= viewDomain.max) {
              const x = valueToPixel(normalizedValue);
              ctx.beginPath();
              ctx.moveTo(x, MARGIN.top + plotHeight);
              ctx.lineTo(x, MARGIN.top + plotHeight + 3);
              ctx.stroke();
            }
          }
        }
      }
    }

    // Draw black/white point markers only if controls are shown
    if (showControls) {
      const blackPixel = valueToPixel(blackPoint);
      const whitePixel = valueToPixel(whitePoint);

      // Draw black point marker only if in view
      if (blackPoint >= viewDomain.min && blackPoint <= viewDomain.max) {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(blackPixel, MARGIN.top);
        ctx.lineTo(blackPixel, MARGIN.top + plotHeight);
        ctx.stroke();

        // Draw black point handle
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(blackPixel, MARGIN.top + plotHeight + 8, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw white point marker only if in view
      if (whitePoint >= viewDomain.min && whitePoint <= viewDomain.max) {
        ctx.strokeStyle = '#ffd93d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(whitePixel, MARGIN.top);
        ctx.lineTo(whitePixel, MARGIN.top + plotHeight);
        ctx.stroke();

        // Draw white point handle
        ctx.fillStyle = '#ffd93d';
        ctx.beginPath();
        ctx.arc(whitePixel, MARGIN.top + plotHeight + 8, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'left';
      ctx.textAlign = 'right';
      ctx.fillText('White', Math.min(width - MARGIN.right, whitePixel + 15), height - 2);

      // Draw Axis Ticks (min/max of view)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`[${viewDomain.min.toFixed(2)}]`, MARGIN.left, height - 2);
      ctx.textAlign = 'right';
      ctx.fillText(`[${viewDomain.max.toFixed(2)}]`, width - MARGIN.right, height - 2);

      // Draw midpoint tick
      const midValue = (viewDomain.min + viewDomain.max) / 2;
      const midPixel = valueToPixel(midValue);
      ctx.textAlign = 'center';
      ctx.fillText(`[${midValue.toFixed(2)}]`, midPixel, height - 2);
      ctx.fillRect(midPixel, MARGIN.top + plotHeight, 1, 3); // Tick mark
    }
  }, [
    histogram,
    blackPoint,
    whitePoint,
    canvasWidth,
    collapsed,
    percentiles,
    stats,
    valueToPixel,
    showControls,
    barColor,
    viewDomain,
  ]);

  // Mouse event handlers for dragging markers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const blackPixel = valueToPixel(blackPoint);
      const whitePixel = valueToPixel(whitePoint);
      const plotHeight = CANVAS_HEIGHT - MARGIN.top - MARGIN.bottom;

      // Check if clicking near black point marker (anywhere along the line or handle)
      // Use larger detection area (15px) for better usability at edges
      if (Math.abs(x - blackPixel) < 15 && y >= MARGIN.top && y <= MARGIN.top + plotHeight + 15) {
        setIsDragging('black');
        return;
      }

      // Check if clicking near white point marker (anywhere along the line or handle)
      if (Math.abs(x - whitePixel) < 15 && y >= MARGIN.top && y <= MARGIN.top + plotHeight + 15) {
        setIsDragging('white');
        return;
      }
    },
    [blackPoint, whitePoint, valueToPixel]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newValue = pixelToValue(x);

      if (isDragging === 'black') {
        // Ensure black point stays below white point
        const clampedValue = Math.min(newValue, whitePoint - 0.01);
        onBlackPointChange?.(Math.max(0, clampedValue));
      } else if (isDragging === 'white') {
        // Ensure white point stays above black point
        const clampedValue = Math.max(newValue, blackPoint + 0.01);
        onWhitePointChange?.(Math.min(1, clampedValue));
      }
    },
    [isDragging, blackPoint, whitePoint, pixelToValue, onBlackPointChange, onWhitePointChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
    onDragEnd?.(); // Notify parent that drag ended
  }, [onDragEnd]);

  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(null);
      onDragEnd?.(); // Notify parent that drag ended
    }
  }, [isDragging, onDragEnd]);

  return (
    <div className={`histogram-panel ${collapsed ? 'collapsed' : ''}`} ref={containerRef}>
      <div className="histogram-header" onClick={onToggleCollapse}>
        <div className="histogram-header-left">
          <Icons.Chart />
          <span className="histogram-title">{title}</span>
        </div>
        <div className="histogram-header-right">
          {onToggleCollapse && (
            <span className="collapse-icon">
              {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="histogram-body">
          {loading ? (
            <div className="histogram-loading">
              <div className="spinner-small"></div>
              <span>Loading histogram...</span>
            </div>
          ) : histogram ? (
            <>
              <canvas
                ref={canvasRef}
                width={canvasWidth}
                height={CANVAS_HEIGHT}
                className="histogram-canvas"
                onMouseDown={showControls ? handleMouseDown : undefined}
                onMouseMove={showControls ? handleMouseMove : undefined}
                onMouseUp={showControls ? handleMouseUp : undefined}
                onMouseLeave={showControls ? handleMouseLeave : undefined}
                style={{ cursor: showControls && isDragging ? 'ew-resize' : 'default' }}
              />
              {showControls && (
                <div className="histogram-hint">Drag markers to adjust black/white points</div>
              )}
            </>
          ) : (
            <div className="histogram-empty">No histogram data available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistogramPanel;
