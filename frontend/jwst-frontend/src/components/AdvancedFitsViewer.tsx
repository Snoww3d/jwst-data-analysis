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
    url: string; // We'll pass the raw file URL here
    onClose: () => void;
}

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

    // Hold data in ref to avoid re-parsing on color change, if needed. 
    // We cache the RAW pixel array (arr) returned by getFrame to avoid calling it again (which causes DataCloneError)
    const [pixelData, setPixelData] = useState<{ arr: any, width: number, height: number, min: number, max: number } | null>(null);

    useEffect(() => {
        const loadFits = async () => {
            try {
                setLoading(true);

                // Ensure astro.FITS is available
                if (!window.astro || !window.astro.FITS) {
                    throw new Error("FITS library not loaded. Please refresh the page.");
                }


                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch FITS file: ${response.status} ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();


                // fitsjs expects a Blob or File (or string URL), not an ArrayBuffer directly in the constructor logic found
                const blob = new Blob([buffer]);

                // Initialize FITS parser using the blob
                new window.astro.FITS(blob, function (this: any) {

                    const hdu = this.getHDU();
                    if (!hdu) {
                        console.error("[FitsViewer] No HDU found");
                        setError("Invalid FITS file: No HDU found");
                        setLoading(false);
                        return;
                    }

                    const header = hdu.header;
                    setHeaderInfo(header);

                    const dataunit = hdu.data;

                    // Initial load: getFrame -> Cache it
                    dataunit.getFrame(0, (arr: any) => {
                        if (!arr) {
                            console.error("[FitsViewer] getFrame callback returned null/undefined");
                            setError("Could not retrieve pixel data");
                            setLoading(false);
                            return;
                        }

                        // Store everything needed for rendering in state
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
            // Basic array check
            if (!arr || !arr.length) {
                throw new Error("Pixel array is empty or invalid");
            }

            // Find min/max for scaling
            let finalMin: number;
            let finalMax: number;

            if (min === undefined || max === undefined) {
                // Auto-scale using ZScale-ish percentile approach
                const scales = calculateZScale(arr);
                finalMin = scales.min;
                finalMax = scales.max;
            } else {
                finalMin = min;
                finalMax = max;
            }

            // Avoid divide by zero
            if (finalMax === finalMin) finalMax = finalMin + 1;
            const range = finalMax - finalMin;
            const validMin = finalMin;

            const data = imgData.data; // The Uint8ClampedArray
            const len = arr.length;

            const lut = getColorMap(colorMap);

            if (!lut || lut.length === 0) {
                console.error("[FitsViewer] Invalid LUT");
                return;
            }

            for (let i = 0; i < len; i++) {
                let val = arr[i];

                // Handle NaN
                if (isNaN(val)) {
                    val = validMin;
                }

                let norm = (val - validMin) / range;
                if (norm < 0) norm = 0;
                if (norm > 1) norm = 1;

                // Map normalized 0..1 to 0..255 integer
                const lutIdx = Math.floor(norm * 255);
                const rgb = lut[lutIdx];

                if (!rgb) {
                    // Fallback to black
                    data[4 * i] = 0;
                    data[4 * i + 1] = 0;
                    data[4 * i + 2] = 0;
                    data[4 * i + 3] = 255;
                    continue;
                }

                data[4 * i] = rgb[0];     // R
                data[4 * i + 1] = rgb[1]; // G
                data[4 * i + 2] = rgb[2]; // B
                data[4 * i + 3] = 255;    // Alpha
            }

            ctx.putImageData(imgData, 0, 0);
            setLoading(false); // Done!

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

    // Re-render when data or colorMap changes
    useEffect(() => {
        if (pixelData && canvasRef.current) {
            // Use requestAnimationFrame to avoid blocking if rapid changes
            requestAnimationFrame(() => renderPixels(pixelData, canvasRef.current));
        }
    }, [pixelData, colorMap, scale, offset, renderPixels]); // Add scale/offset if we did canvas-based zoom, but we use CSS transform for zoom.

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

    return (
        <div className="advanced-fits-viewer">
            <div className="fits-toolbar">
                <button onClick={onClose} className="btn-secondary">Back</button>
                <div className="fits-controls-group">
                    <label>Zoom</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={handleZoomOut} className="btn-small">-</button>
                        <button onClick={handleReset} className="btn-small">{(scale * 100).toFixed(0)}%</button>
                        <button onClick={handleZoomIn} className="btn-small">+</button>
                    </div>
                </div>
                <div className="fits-controls-group">
                    <label>Color Map</label>
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
                    </select>
                </div>
                {headerInfo && (
                    <div style={{ fontSize: '0.8rem', color: '#ccc' }}>
                        {headerInfo.cards['OBJECT']?.value || 'Unknown Object'} |
                        {headerInfo.cards['INSTRUME']?.value || 'Unknown Inst'}
                    </div>
                )}
            </div>

            <div
                className="fits-canvas-container"
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {loading && <div className="fits-loading">Loading FITS data...</div>}
                {error && <div className="fits-error">{error}</div>}

                <canvas
                    ref={canvasRef}
                    className="fits-canvas"
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
                    }}
                />
            </div>
        </div>
    );
};

export default AdvancedFitsViewer;
