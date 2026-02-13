import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';
import type { ImageSelection } from './ComparisonImagePicker';
import './ImageComparisonViewer.css';

type ComparisonMode = 'blink' | 'side-by-side' | 'overlay';

interface ImageComparisonViewerProps {
  imageA: ImageSelection;
  imageB: ImageSelection;
  isOpen: boolean;
  onClose: () => void;
}

const COLORMAPS = [
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'hot', label: 'Hot' },
  { value: 'cool', label: 'Cool' },
  { value: 'rainbow', label: 'Rainbow' },
];

function buildPreviewUrl(dataId: string, colormap: string): string {
  return (
    `${API_BASE_URL}/api/jwstdata/${dataId}/preview?` +
    `cmap=${colormap}&width=1200&height=1200&stretch=zscale`
  );
}

async function fetchAuthBlob(url: string): Promise<string> {
  const token = localStorage.getItem('jwst_auth_token');
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

const ImageComparisonViewer: React.FC<ImageComparisonViewerProps> = ({
  imageA,
  imageB,
  isOpen,
  onClose,
}) => {
  const [mode, setMode] = useState<ComparisonMode>('blink');
  const [colormap, setColormap] = useState('grayscale');

  // Image blob URLs
  const [blobUrlA, setBlobUrlA] = useState<string | null>(null);
  const [blobUrlB, setBlobUrlB] = useState<string | null>(null);
  const [loadingA, setLoadingA] = useState(true);
  const [loadingB, setLoadingB] = useState(true);

  // Blink state
  const [blinkShowA, setBlinkShowA] = useState(true);
  const [isAutoBlinking, setIsAutoBlinking] = useState(false);
  const [blinkInterval, setBlinkInterval] = useState(500);

  // Overlay state
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);

  // Shared zoom/pan
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch previews
  useEffect(() => {
    if (!isOpen) return;
    let revoked = false;

    const fetchA = async () => {
      setLoadingA(true);
      try {
        const url = buildPreviewUrl(imageA.dataId, colormap);
        const blobUrl = await fetchAuthBlob(url);
        if (!revoked) setBlobUrlA(blobUrl);
      } catch {
        // Silently fail - image will show loading state
      } finally {
        if (!revoked) setLoadingA(false);
      }
    };

    const fetchB = async () => {
      setLoadingB(true);
      try {
        const url = buildPreviewUrl(imageB.dataId, colormap);
        const blobUrl = await fetchAuthBlob(url);
        if (!revoked) setBlobUrlB(blobUrl);
      } catch {
        // Silently fail
      } finally {
        if (!revoked) setLoadingB(false);
      }
    };

    fetchA();
    fetchB();

    return () => {
      revoked = true;
    };
  }, [isOpen, imageA.dataId, imageB.dataId, colormap]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      setBlobUrlA((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setBlobUrlB((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setBlinkShowA(true);
      setIsAutoBlinking(false);
      setOverlayOpacity(0.5);
    }
  }, [isOpen]);

  // Auto-blink timer
  useEffect(() => {
    if (isAutoBlinking && mode === 'blink') {
      blinkTimerRef.current = setInterval(() => {
        setBlinkShowA((prev) => !prev);
      }, blinkInterval);
    }
    return () => {
      if (blinkTimerRef.current) {
        clearInterval(blinkTimerRef.current);
        blinkTimerRef.current = null;
      }
    };
  }, [isAutoBlinking, blinkInterval, mode]);

  // Stop auto-blink when leaving blink mode
  useEffect(() => {
    if (mode !== 'blink') {
      setIsAutoBlinking(false);
    }
  }, [mode]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === ' ' || e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (mode === 'blink') {
          setBlinkShowA((prev) => !prev);
        }
      }
      if (e.key === '1') {
        e.preventDefault();
        setMode('blink');
      }
      if (e.key === '2') {
        e.preventDefault();
        setMode('side-by-side');
      }
      if (e.key === '3') {
        e.preventDefault();
        setMode('overlay');
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (mode === 'blink') {
          setIsAutoBlinking((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, mode]);

  // Zoom handlers
  const handleZoomIn = () => setScale((s) => Math.min(s * 1.2, 10));
  const handleZoomOut = () => setScale((s) => Math.max(s / 1.2, 0.1));
  const handleResetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.1, Math.min(10, s * delta)));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      }
    },
    [offset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const imageTransform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  const isLoading = loadingA || loadingB;

  if (!isOpen) return null;

  // ---- Blink Mode Viewport ----
  const renderBlinkViewport = () => {
    const currentUrl = blinkShowA ? blobUrlA : blobUrlB;
    return (
      <div
        className="comparison-blink-viewport"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {currentUrl && (
          <img
            src={currentUrl}
            alt={blinkShowA ? imageA.title : imageB.title}
            className="comparison-blink-image"
            style={{ transform: imageTransform }}
            draggable={false}
          />
        )}
        <div className="comparison-blink-indicator">
          <span className={`blink-indicator-dot ${blinkShowA ? 'dot-a' : 'dot-b'}`} />
          <span style={{ color: blinkShowA ? '#4cc9f0' : '#ffa500' }}>
            {blinkShowA ? 'A' : 'B'}
          </span>
        </div>
      </div>
    );
  };

  // ---- Side-by-Side Mode Viewport ----
  const renderSideBySideViewport = () => (
    <div className="comparison-sidebyside-viewport">
      <div
        className="comparison-sidebyside-panel"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <span className="comparison-panel-label label-a">A</span>
        {blobUrlA && (
          <img
            src={blobUrlA}
            alt={imageA.title}
            className="comparison-sidebyside-image"
            style={{ transform: imageTransform }}
            draggable={false}
          />
        )}
      </div>
      <div className="comparison-sidebyside-divider" />
      <div
        className="comparison-sidebyside-panel"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <span className="comparison-panel-label label-b">B</span>
        {blobUrlB && (
          <img
            src={blobUrlB}
            alt={imageB.title}
            className="comparison-sidebyside-image"
            style={{ transform: imageTransform }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );

  // ---- Overlay Mode Viewport ----
  const renderOverlayViewport = () => (
    <div
      className="comparison-overlay-viewport"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <div className="comparison-overlay-stack" style={{ transform: imageTransform }}>
        {blobUrlA && (
          <img
            src={blobUrlA}
            alt={imageA.title}
            className="comparison-overlay-image overlay-base"
            draggable={false}
          />
        )}
        {blobUrlB && (
          <img
            src={blobUrlB}
            alt={imageB.title}
            className="comparison-overlay-image overlay-top"
            style={{ opacity: overlayOpacity }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );

  // ---- Mode-specific toolbar controls ----
  const renderModeControls = () => {
    if (mode === 'blink') {
      return (
        <>
          <div className="comparison-toolbar-divider" />
          <div className="comparison-toolbar-group">
            <button
              className="blink-toggle-btn"
              onClick={() => setBlinkShowA((prev) => !prev)}
              title="Toggle image (Space/B)"
            >
              {blinkShowA ? 'A' : 'B'} &rarr; {blinkShowA ? 'B' : 'A'}
            </button>
          </div>
          <div className="comparison-toolbar-divider" />
          <div className="comparison-toolbar-group">
            <button
              className={`blink-auto-btn ${isAutoBlinking ? 'active' : ''}`}
              onClick={() => setIsAutoBlinking((prev) => !prev)}
              title="Auto-blink (P)"
            >
              {isAutoBlinking ? 'Stop' : 'Auto'}
            </button>
            <span className="comparison-toolbar-label">Speed</span>
            <input
              type="range"
              className="blink-speed-slider"
              min={100}
              max={3000}
              step={100}
              value={blinkInterval}
              onChange={(e) => setBlinkInterval(Number(e.target.value))}
              title={`${blinkInterval}ms`}
            />
            <span className="blink-speed-value">{blinkInterval}ms</span>
          </div>
        </>
      );
    }

    if (mode === 'overlay') {
      return (
        <>
          <div className="comparison-toolbar-divider" />
          <div className="comparison-toolbar-group">
            <div className="overlay-opacity-labels">
              <span className="overlay-label-a">A</span>
            </div>
            <input
              type="range"
              className="overlay-opacity-slider"
              min={0}
              max={1}
              step={0.01}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              title={`Opacity: ${Math.round(overlayOpacity * 100)}%`}
            />
            <div className="overlay-opacity-labels">
              <span className="overlay-label-b">B</span>
            </div>
            <span className="overlay-opacity-value">{Math.round(overlayOpacity * 100)}%</span>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <div className="comparison-viewer-overlay">
      <div className="comparison-viewer-container">
        {/* Header */}
        <div className="comparison-header">
          <div className="comparison-header-left">
            <button
              className="btn-icon"
              onClick={onClose}
              title="Close (Escape)"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <div className="comparison-header-titles">
              <span className="comparison-title-label label-a">A</span>
              <span className="comparison-title-a" title={imageA.title}>
                {imageA.title}
              </span>
              <span className="comparison-title-vs">vs</span>
              <span className="comparison-title-label label-b">B</span>
              <span className="comparison-title-b" title={imageB.title}>
                {imageB.title}
              </span>
            </div>
          </div>

          <div className="comparison-header-center">
            <button
              className={`comparison-mode-btn ${mode === 'blink' ? 'active' : ''}`}
              onClick={() => setMode('blink')}
              title="Blink mode (1)"
            >
              Blink
            </button>
            <button
              className={`comparison-mode-btn ${mode === 'side-by-side' ? 'active' : ''}`}
              onClick={() => setMode('side-by-side')}
              title="Side by side (2)"
            >
              Side by Side
            </button>
            <button
              className={`comparison-mode-btn ${mode === 'overlay' ? 'active' : ''}`}
              onClick={() => setMode('overlay')}
              title="Overlay mode (3)"
            >
              Overlay
            </button>
          </div>

          <div className="comparison-header-right">
            <select
              className="comparison-cmap-select"
              value={colormap}
              onChange={(e) => setColormap(e.target.value)}
              title="Colormap"
            >
              {COLORMAPS.map((cm) => (
                <option key={cm.value} value={cm.value}>
                  {cm.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Viewport */}
        <div className="comparison-viewport">
          {isLoading && (
            <div className="comparison-loading-overlay">
              <div className="spinner" />
            </div>
          )}

          {mode === 'blink' && renderBlinkViewport()}
          {mode === 'side-by-side' && renderSideBySideViewport()}
          {mode === 'overlay' && renderOverlayViewport()}

          {/* Floating Toolbar */}
          <div className="comparison-floating-toolbar">
            <div className="comparison-toolbar-group">
              <button className="comparison-zoom-btn" onClick={handleZoomOut} title="Zoom Out">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <button
                className="comparison-zoom-level"
                onClick={handleResetZoom}
                title="Reset Zoom"
              >
                {Math.round(scale * 100)}%
              </button>
              <button className="comparison-zoom-btn" onClick={handleZoomIn} title="Zoom In">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>

            {renderModeControls()}
          </div>
        </div>

        {/* Status bar */}
        <div className="comparison-status-bar">
          <span className="comparison-status-hint">
            {mode === 'blink' && 'Space/B: toggle | P: auto-blink | 1/2/3: switch mode'}
            {mode === 'side-by-side' && 'Scroll to zoom | Drag to pan | 1/2/3: switch mode'}
            {mode === 'overlay' && 'Slider blends A/B | Scroll to zoom | 1/2/3: switch mode'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ImageComparisonViewer;
