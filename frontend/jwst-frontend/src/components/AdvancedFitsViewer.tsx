import React, { useEffect, useRef, useState, useCallback } from 'react';
import './AdvancedFitsViewer.css';
import { calculateZScale } from '../utils/fitsUtils';
import { getColorMap } from '../utils/colormaps';

// Declare global types for fitsjs
declare global {
    interface Window {
        astro: {
            FITS: any;
        }
    }
}

interface AdvancedFitsViewerProps {
    dataId: string;
    url: string;
    onClose: () => void;
}

// Simple Icons
const Icons = {
    Back: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
    ),
    Info: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
    ),
    Download: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    ),
    ZoomIn: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
    ),
    ZoomOut: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
    ),
    Refresh: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
    ),
    Palette: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
        </svg>
    )
};

const AdvancedFitsViewer: React.FC<AdvancedFitsViewerProps> = ({ dataId, url, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [scale, setScale] = useState<number>(1);
    const [colorMap, setColorMap] = useState<string>('grayscale');
    const [offset, setOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
    const [headerInfo, setHeaderInfo] = useState<any>(null);
    const [pixelData, setPixelData] = useState<{ arr: any, width: number, height: number, min: number, max: number } | null>(null);

    // UI State
    const [showMetadata, setShowMetadata] = useState<boolean>(false);

    useEffect(() => {
        const loadFits = async () => {
            try {
                setLoading(true);

                if (!window.astro || !window.astro.FITS) {
                    throw new Error("FITS library not loaded. Please refresh the page.");
                }

                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch FITS file: ${response.status} ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();
                const blob = new Blob([buffer]);

                new window.astro.FITS(blob, function (this: any) {
                    const hdu = this.getHDU();
                    if (!hdu) {
                        setError("Invalid FITS file: No HDU found");
                        setLoading(false);
                        return;
                    }

                    const header = hdu.header;
                    setHeaderInfo(header);
                    const dataunit = hdu.data;

                    dataunit.getFrame(0, (arr: any) => {
                        if (!arr) {
                            setError("Could not retrieve pixel data");
                            setLoading(false);
                            return;
                        }

                        setPixelData({
                            arr: arr,
                            width: dataunit.width,
                            height: dataunit.height,
                            min: dataunit.min,
                            max: dataunit.max
                        });
                        setLoading(false);
                    });
                });

            } catch (err: any) {
                console.error("FITS load error:", err);
                setError(err.message || "Failed to load FITS file");
                setLoading(false);
            }
        };

        if (url) {
            loadFits();
        }
    }, [url]);

    const processPixels = useCallback((arr: any, width: number, height: number, min: number | undefined, max: number | undefined, ctx: CanvasRenderingContext2D, imgData: ImageData) => {
        try {
            if (!arr || !arr.length) return;

            let finalMin: number;
            let finalMax: number;

            if (min === undefined || max === undefined) {
                const scales = calculateZScale(arr);
                finalMin = scales.min;
                finalMax = scales.max;
            } else {
                finalMin = min;
                finalMax = max;
            }

            if (finalMax === finalMin) finalMax = finalMin + 1;
            const range = finalMax - finalMin;
            const validMin = finalMin;

            const data = imgData.data;
            const len = arr.length;
            const lut = getColorMap(colorMap);

            if (!lut || lut.length === 0) return;

            for (let i = 0; i < len; i++) {
                let val = arr[i];
                if (isNaN(val)) val = validMin;

                let norm = (val - validMin) / range;
                if (norm < 0) norm = 0;
                if (norm > 1) norm = 1;

                const lutIdx = Math.floor(norm * 255);
                const rgb = lut[lutIdx];

                if (!rgb) {
                    data[4 * i] = 0; // R
                    data[4 * i + 1] = 0; // G
                    data[4 * i + 2] = 0; // B
                    data[4 * i + 3] = 255; // Alpha
                    continue;
                }

                data[4 * i] = rgb[0];
                data[4 * i + 1] = rgb[1];
                data[4 * i + 2] = rgb[2];
                data[4 * i + 3] = 255;
            }

            ctx.putImageData(imgData, 0, 0);
            setLoading(false);

        } catch (e: any) {
            console.error("processPixels error", e);
            setError("Error processing pixels: " + e.message);
            setLoading(false);
        }
    }, [colorMap]);

    const renderPixels = useCallback((data: { arr: any, width: number, height: number, min: number, max: number }, canvas: HTMLCanvasElement | null) => {
        try {
            if (!canvas || !data) return;
            const { arr, width, height, min, max } = data;

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const imgData = ctx.createImageData(width, height);
            processPixels(arr, width, height, min, max, ctx, imgData);

        } catch (err: any) {
            console.error("[FitsViewer] renderPixels error:", err);
            setError("Error rendering FITS data: " + err.message);
        }
    }, [processPixels]);

    useEffect(() => {
        if (pixelData && canvasRef.current) {
            requestAnimationFrame(() => renderPixels(pixelData, canvasRef.current));
        }
    }, [pixelData, colorMap, scale, offset, renderPixels]);

    // Initial Fit-to-Screen Logic
    useEffect(() => {
        if (pixelData && containerRef.current) {
            const { width: imgWidth, height: imgHeight } = pixelData;
            const { clientWidth: containerWidth, clientHeight: containerHeight } = containerRef.current;

            // Calculate scale to fit 90% of container
            const scaleX = containerWidth / imgWidth;
            const scaleY = containerHeight / imgHeight;
            const optimalScale = Math.min(scaleX, scaleY) * 0.9;

            setScale(optimalScale);
            setOffset({ x: 0, y: 0 });
        }
    }, [pixelData]);

    // Zoom handlers
    const handleZoomIn = () => setScale(s => s * 1.2);
    const handleZoomOut = () => setScale(s => Math.max(0.1, s / 1.2));
    const handleReset = () => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    };

    // Pan handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        setOffset({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y
        });
    };

    const handleMouseUp = () => setIsDragging(false);

    // Helpers to extract header info safely
    const getHeaderValue = (key: string) => headerInfo?.cards[key]?.value || 'N/A';

    return (
        <div className="advanced-fits-viewer-grid">
            {/* Main Content Area (Header + Canvas + Toolbar) */}
            <main className="viewer-main-content">
                {/* Top Header - Contained */}
                <header className="viewer-header">
                    <div className="header-left">
                        <button onClick={onClose} className="btn-icon" title="Go Back">
                            <Icons.Back />
                        </button>
                        <div className="header-breadcrumbs">
                            <span className="breadcrumb-item">{getHeaderValue('OBJECT')}</span>
                            <span className="breadcrumb-separator">/</span>
                            <span className="breadcrumb-item active">{getHeaderValue('INSTRUME')}</span>
                        </div>
                    </div>

                    <div className="header-right">
                        <button className="btn-icon" title="Download FITS">
                            <Icons.Download />
                        </button>
                    </div>
                </header>

                {/* Canvas Container */}
                <div
                    className="canvas-viewport"
                    ref={containerRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {loading && (
                        <div className="viewer-loading-state">
                            <div className="spinner"></div>
                            <span>Loading Data...</span>
                        </div>
                    )}

                    {error && <div className="viewer-error-state">{error}</div>}

                    <canvas
                        ref={canvasRef}
                        className="scientific-canvas"
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
                        }}
                    />

                    {/* Floating Toolbar - Centered in Viewport */}
                    <div className="viewer-floating-toolbar">
                        <div className="toolbar-group">
                            <button onClick={handleZoomOut} className="btn-icon" title="Zoom Out">
                                <Icons.ZoomOut />
                            </button>
                            <button onClick={handleReset} className="btn-text" title="Reset View">
                                {(scale * 100).toFixed(0)}%
                            </button>
                            <button onClick={handleZoomIn} className="btn-icon" title="Zoom In">
                                <Icons.ZoomIn />
                            </button>
                        </div>

                        <div className="toolbar-divider" />

                        <div className="toolbar-group">
                            <div className="fits-select-wrapper">
                                <Icons.Palette />
                                <select
                                    value={colorMap}
                                    onChange={(e) => setColorMap(e.target.value)}
                                    className="fits-select"
                                >
                                    <option value="grayscale">Grayscale</option>
                                    <option value="heat">Heat</option>
                                    <option value="cool">Cool</option>
                                    <option value="rainbow">Rainbow</option>
                                    <option value="viridis">Viridis</option>
                                    <option value="magma">Magma</option>
                                    <option value="inferno">Inferno</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Permanent Sidebar */}
            <aside className="viewer-sidebar">
                <div className="sidebar-header">
                    <h3>Metadata</h3>
                </div>
                <div className="sidebar-content">
                    {headerInfo ? (
                        <div className="metadata-grid">
                            {Object.entries(headerInfo).map(([key, value]) => {
                                // Filter out history/comment for cleaner view
                                if (key === 'HISTORY' || key === 'COMMENT' || key === '') return null;
                                return (
                                    <div key={key} className="metadata-row">
                                        <span className="meta-key">{key}</span>
                                        <span className="meta-value">{String(value)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="metadata-empty">No Header Data</div>
                    )}
                </div>
            </aside>
        </div>
    );
};

export default AdvancedFitsViewer;
