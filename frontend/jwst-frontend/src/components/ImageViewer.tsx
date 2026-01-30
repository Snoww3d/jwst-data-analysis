import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ImageViewer.css';
import './FitsViewer.css';
import { API_BASE_URL } from '../config/api';
import StretchControls, { StretchParams } from './StretchControls';

interface ImageViewerProps {
    dataId: string;
    title: string;
    onClose: () => void;
    isOpen: boolean;
    metadata?: Record<string, unknown>;
}

// SVG Icons
const Icons = {
    Back: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
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
    Palette: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
        </svg>
    )
};

const COLORMAPS = [
    { value: 'inferno', label: 'Inferno' },
    { value: 'magma', label: 'Magma' },
    { value: 'viridis', label: 'Viridis' },
    { value: 'plasma', label: 'Plasma' },
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'hot', label: 'Hot' },
    { value: 'cool', label: 'Cool' },
    { value: 'rainbow', label: 'Rainbow' },
];

const DEFAULT_STRETCH_PARAMS: StretchParams = {
    stretch: 'zscale',
    gamma: 1.0,
    blackPoint: 0.0,
    whitePoint: 1.0,
    asinhA: 0.1,
};

const ImageViewer: React.FC<ImageViewerProps> = ({ dataId, title, onClose, isOpen, metadata }) => {
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [colormap, setColormap] = useState<string>('inferno');
    const [scale, setScale] = useState<number>(1);
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [imageKey, setImageKey] = useState<number>(0);
    const [stretchParams, setStretchParams] = useState<StretchParams>(DEFAULT_STRETCH_PARAMS);
    const [pendingStretchParams, setPendingStretchParams] = useState<StretchParams>(DEFAULT_STRETCH_PARAMS);
    const [stretchControlsCollapsed, setStretchControlsCollapsed] = useState<boolean>(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Build preview URL with all parameters (uses committed stretchParams, not pending)
    const imageUrl = `${API_BASE_URL}/api/jwstdata/${dataId}/preview?` +
        `cmap=${colormap}` +
        `&width=1200&height=1200` +
        `&stretch=${stretchParams.stretch}` +
        `&gamma=${stretchParams.gamma}` +
        `&blackPoint=${stretchParams.blackPoint}` +
        `&whitePoint=${stretchParams.whitePoint}` +
        `&asinhA=${stretchParams.asinhA}` +
        `&t=${imageKey}`;

    // Reset view when opening
    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            setError(null);
            setScale(1);
            setOffset({ x: 0, y: 0 });
            setStretchParams(DEFAULT_STRETCH_PARAMS);
            setPendingStretchParams(DEFAULT_STRETCH_PARAMS);
        }
    }, [isOpen, dataId]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    // Handle stretch parameter changes with debouncing
    const handleStretchParamsChange = useCallback((newParams: StretchParams) => {
        // Update pending params immediately for responsive UI display
        setPendingStretchParams(newParams);

        // Clear any existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set new timer to commit changes after 500ms of no changes
        debounceTimerRef.current = setTimeout(() => {
            setStretchParams(newParams);
            setLoading(true);
            setImageKey(prev => prev + 1);
        }, 500);
    }, []);

    // Handle colormap change
    const handleColormapChange = (newCmap: string) => {
        setColormap(newCmap);
        setLoading(true);
        setImageKey(prev => prev + 1);
    };

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Zoom handlers
    const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 10));
    const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.1));
    const handleReset = () => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    };

    // Mouse wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(s => Math.max(0.1, Math.min(10, s * delta)));
    }, []);

    // Pan handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
        }
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

    // Extract useful metadata for display
    const getDisplayMetadata = () => {
        if (!metadata) return {};
        const display: Record<string, string> = {};

        // Priority fields to show
        const priorityFields = [
            'mast_obs_id', 'mast_target_name', 'mast_instrument_name',
            'mast_filters', 'mast_t_exptime', 'mast_calib_level',
            'mast_proposal_id', 'mast_obs_title'
        ];

        for (const field of priorityFields) {
            if (metadata[field] !== undefined && metadata[field] !== null) {
                const label = field.replace('mast_', '').replace(/_/g, ' ').toUpperCase();
                display[label] = String(metadata[field]);
            }
        }

        return display;
    };

    const displayMeta = getDisplayMetadata();
    const targetName = metadata?.mast_target_name as string || 'Unknown Target';
    const instrument = metadata?.mast_instrument_name as string || 'JWST';
    const filter = metadata?.mast_filters as string || '';
    const obsTitle = metadata?.mast_obs_title as string || '';

    if (!isOpen) return null;

    return (
        <div className="image-viewer-overlay" onClick={onClose}>
            <div className="image-viewer-container advanced-mode" onClick={e => e.stopPropagation()}>
                <div className="advanced-fits-viewer-grid">
                    {/* Main Content Area */}
                    <main className="viewer-main-content">
                        {/* Header */}
                        <header className="viewer-header">
                            <div className="header-left">
                                <button onClick={onClose} className="btn-icon" title="Go Back">
                                    <Icons.Back />
                                </button>
                                <div className="header-title-block">
                                    {obsTitle && (
                                        <h1 className="header-obs-title">{obsTitle}</h1>
                                    )}
                                    <div className="header-breadcrumbs">
                                        <span className="breadcrumb-item">{targetName}</span>
                                        <span className="breadcrumb-separator">/</span>
                                        <span className="breadcrumb-item">{instrument}</span>
                                        {filter && (
                                            <>
                                                <span className="breadcrumb-separator">/</span>
                                                <span className="breadcrumb-item active">{filter}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="header-right">
                                <button
                                    className="btn-icon"
                                    title="Download FITS"
                                    onClick={() => window.open(`${API_BASE_URL}/api/jwstdata/${dataId}/file`, '_blank')}
                                >
                                    <Icons.Download />
                                </button>
                            </div>
                        </header>

                        {/* Image Viewport */}
                        <div
                            className="canvas-viewport"
                            ref={containerRef}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onWheel={handleWheel}
                        >
                            {loading && (
                                <div className="viewer-loading-state">
                                    <div className="spinner"></div>
                                    <span>Generating preview...</span>
                                </div>
                            )}

                            {error && <div className="viewer-error-state">{error}</div>}

                            <img
                                ref={imageRef}
                                src={imageUrl}
                                alt={`Preview of ${title}`}
                                className="scientific-canvas"
                                style={{
                                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                                    cursor: isDragging ? 'grabbing' : 'grab',
                                    display: loading && !error ? 'none' : 'block',
                                    maxWidth: 'none',
                                    maxHeight: 'none'
                                }}
                                onError={() => {
                                    setError("Failed to generate preview. The file may not contain viewable image data.");
                                    setLoading(false);
                                }}
                                onLoad={() => setLoading(false)}
                                draggable={false}
                            />

                            {/* Floating Toolbar */}
                            <div className="viewer-floating-toolbar">
                                <div className="toolbar-group">
                                    <button onClick={handleZoomOut} className="btn-icon" title="Zoom Out">
                                        <Icons.ZoomOut />
                                    </button>
                                    <button onClick={handleReset} className="btn-text" title="Reset View">
                                        {Math.round(scale * 100)}%
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
                                            value={colormap}
                                            onChange={(e) => handleColormapChange(e.target.value)}
                                            className="fits-select"
                                        >
                                            {COLORMAPS.map(cm => (
                                                <option key={cm.value} value={cm.value}>{cm.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Stretch Controls Panel */}
                            <div
                                className="viewer-stretch-panel"
                                onMouseDown={e => e.stopPropagation()}
                                onMouseMove={e => e.stopPropagation()}
                                onWheel={e => e.stopPropagation()}
                            >
                                <StretchControls
                                    params={pendingStretchParams}
                                    onChange={handleStretchParamsChange}
                                    collapsed={stretchControlsCollapsed}
                                    onToggleCollapse={() => setStretchControlsCollapsed(!stretchControlsCollapsed)}
                                />
                            </div>
                        </div>
                    </main>

                    {/* Sidebar */}
                    <aside className="viewer-sidebar">
                        <div className="sidebar-header">
                            <h3>Metadata</h3>
                        </div>
                        <div className="sidebar-content">
                            {Object.keys(displayMeta).length > 0 ? (
                                <div className="metadata-grid">
                                    <div className="metadata-row">
                                        <span className="meta-key">FILENAME</span>
                                        <span className="meta-value" title={title}>{title}</span>
                                    </div>
                                    {Object.entries(displayMeta).map(([key, value]) => (
                                        <div key={key} className="metadata-row">
                                            <span className="meta-key">{key}</span>
                                            <span className="meta-value" title={value}>{value}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="metadata-empty">No metadata available</div>
                            )}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default ImageViewer;
