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
    percentiles: PercentileData | null;
    stats: HistogramStats | null;
    blackPoint: number;  // 0.0 to 1.0
    whitePoint: number;  // 0.0 to 1.0
    onBlackPointChange: (value: number) => void;
    onWhitePointChange: (value: number) => void;
    loading?: boolean;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

// SVG Icons
const Icons = {
    Chart: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M18 17V9"/>
            <path d="M13 17V5"/>
            <path d="M8 17v-3"/>
        </svg>
    ),
    ChevronDown: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
    ),
    ChevronUp: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
    ),
};

const HistogramPanel: React.FC<HistogramPanelProps> = ({
    histogram,
    percentiles,
    stats,
    blackPoint,
    whitePoint,
    onBlackPointChange,
    onWhitePointChange,
    loading = false,
    collapsed = false,
    onToggleCollapse,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState<'black' | 'white' | null>(null);
    const [canvasWidth, setCanvasWidth] = useState(300);

    const CANVAS_HEIGHT = 100;
    const MARGIN = { top: 5, right: 10, bottom: 20, left: 10 };

    // Resize observer for responsive canvas
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const width = entry.contentRect.width - 20; // Account for padding
                setCanvasWidth(Math.max(200, width));
            }
        });

        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    // Convert pixel position to 0-1 range
    const pixelToValue = useCallback((pixelX: number): number => {
        const plotWidth = canvasWidth - MARGIN.left - MARGIN.right;
        const x = Math.max(0, Math.min(plotWidth, pixelX - MARGIN.left));
        return x / plotWidth;
    }, [canvasWidth]);

    // Convert 0-1 range to pixel position
    const valueToPixel = useCallback((value: number): number => {
        const plotWidth = canvasWidth - MARGIN.left - MARGIN.right;
        return MARGIN.left + value * plotWidth;
    }, [canvasWidth]);

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
        const logCounts = counts.map(c => c > 0 ? Math.log10(c + 1) : 0);
        const maxLogCount = Math.max(...logCounts);

        if (maxLogCount === 0) return;

        const barWidth = plotWidth / counts.length;

        // Draw clipped regions (dark areas outside black/white points)
        const blackPixel = valueToPixel(blackPoint);
        const whitePixel = valueToPixel(whitePoint);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(MARGIN.left, MARGIN.top, blackPixel - MARGIN.left, plotHeight);
        ctx.fillRect(whitePixel, MARGIN.top, width - MARGIN.right - whitePixel, plotHeight);

        // Draw histogram bars
        ctx.fillStyle = '#4cc9f0';
        for (let i = 0; i < counts.length; i++) {
            const barHeight = (logCounts[i] / maxLogCount) * plotHeight;
            const x = MARGIN.left + i * barWidth;
            const y = MARGIN.top + plotHeight - barHeight;
            ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
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
                        const x = valueToPixel(normalizedValue);
                        
                        ctx.beginPath();
                        ctx.moveTo(x, MARGIN.top + plotHeight);
                        ctx.lineTo(x, MARGIN.top + plotHeight + 3);
                        ctx.stroke();
                    }
                }
            }
        }

        // Draw black point marker
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

        // Draw white point marker
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

        // Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText('Black', Math.max(MARGIN.left, blackPixel - 15), height - 2);
        ctx.textAlign = 'right';
        ctx.fillText('White', Math.min(width - MARGIN.right, whitePixel + 15), height - 2);

    }, [histogram, blackPoint, whitePoint, canvasWidth, collapsed, percentiles, stats, valueToPixel]);

    // Mouse event handlers for dragging markers
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const blackPixel = valueToPixel(blackPoint);
        const whitePixel = valueToPixel(whitePoint);
        const handleY = MARGIN.top + (CANVAS_HEIGHT - MARGIN.top - MARGIN.bottom) + 8;

        // Check if clicking near black point handle
        if (Math.abs(x - blackPixel) < 10 && Math.abs(y - handleY) < 15) {
            setIsDragging('black');
            return;
        }

        // Check if clicking near white point handle
        if (Math.abs(x - whitePixel) < 10 && Math.abs(y - handleY) < 15) {
            setIsDragging('white');
            return;
        }
    }, [blackPoint, whitePoint, valueToPixel]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDragging) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const newValue = pixelToValue(x);

        if (isDragging === 'black') {
            // Ensure black point stays below white point
            const clampedValue = Math.min(newValue, whitePoint - 0.01);
            onBlackPointChange(Math.max(0, clampedValue));
        } else if (isDragging === 'white') {
            // Ensure white point stays above black point
            const clampedValue = Math.max(newValue, blackPoint + 0.01);
            onWhitePointChange(Math.min(1, clampedValue));
        }
    }, [isDragging, blackPoint, whitePoint, pixelToValue, onBlackPointChange, onWhitePointChange]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(null);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (isDragging) {
            setIsDragging(null);
        }
    }, [isDragging]);

    return (
        <div className={`histogram-panel ${collapsed ? 'collapsed' : ''}`} ref={containerRef}>
            <div className="histogram-header" onClick={onToggleCollapse}>
                <div className="histogram-header-left">
                    <Icons.Chart />
                    <span className="histogram-title">Histogram</span>
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
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseLeave}
                                style={{ cursor: isDragging ? 'ew-resize' : 'default' }}
                            />
                            <div className="histogram-hint">
                                Drag markers to adjust black/white points
                            </div>
                        </>
                    ) : (
                        <div className="histogram-empty">
                            No histogram data available
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default HistogramPanel;
