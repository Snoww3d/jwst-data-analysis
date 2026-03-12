import type React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { WALLPAPER_PRESETS } from '../../types/CompositeTypes';
import type { WallpaperPreset } from '../../types/CompositeTypes';
import './ExportFramingPanel.css';

export interface ExportFramingResult {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  rotationDegrees: number;
  cropCenterX: number;
  cropCenterY: number;
  cropZoom: number;
}

interface ExportFramingPanelProps {
  previewUrl: string | null;
  rotation: number;
  disabled?: boolean;
  isRegenerating?: boolean;
  onExport: (result: ExportFramingResult) => void;
}

interface ContentBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Matches server _auto_crop threshold=0.005 → 0.005*255≈1.275
const CONTENT_THRESHOLD = 1;

/**
 * Detect the bounding box of non-black content in the preview image.
 * This mirrors the server's _auto_crop detection so the client and server
 * agree on where the content is within the preview canvas.
 */
function detectContentBounds(img: HTMLImageElement): ContentBounds | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  let top = h,
    left = w,
    bottom = 0,
    right = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (
        data[i] > CONTENT_THRESHOLD ||
        data[i + 1] > CONTENT_THRESHOLD ||
        data[i + 2] > CONTENT_THRESHOLD
      ) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom <= top || right <= left) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Compute optimal zoom to fill the target aspect ratio given content dimensions.
 * At zoom=1.0 the content fits entirely (possibly with black bars on one axis).
 * The returned zoom fills both axes so no black bars remain.
 */
function computeAutoFit(
  contentW: number,
  contentH: number,
  targetW: number,
  targetH: number,
  rotation: number
): { zoom: number; centerX: number; centerY: number } {
  const rad = (-rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));

  // Rotated content dimensions (matching server's scipy rotate with reshape=True)
  const rotW = Math.abs(rotation) > 0.01 ? contentW * cos + contentH * sin : contentW;
  const rotH = Math.abs(rotation) > 0.01 ? contentW * sin + contentH * cos : contentH;

  // baseScale fits content into target; fillScale fills target (no black bars)
  const fitScaleX = targetW / rotW;
  const fitScaleY = targetH / rotH;
  const baseScale = Math.min(fitScaleX, fitScaleY);
  const fillScale = Math.max(fitScaleX, fitScaleY);
  const zoom = Math.max(1.0, Math.min(fillScale / baseScale, 3.0));

  return { zoom, centerX: 0.5, centerY: 0.5 };
}

export function ExportFramingPanel({
  previewUrl,
  rotation,
  disabled,
  isRegenerating,
  onExport,
}: ExportFramingPanelProps) {
  const [selectedPreset, setSelectedPreset] = useState<WallpaperPreset | null>(
    WALLPAPER_PRESETS[0]
  );
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [cropZoom, setCropZoom] = useState(1.0);
  const [cropCenterX, setCropCenterX] = useState(0.5);
  const [cropCenterY, setCropCenterY] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boundsRef = useRef<ContentBounds | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(280);

  const targetW = selectedPreset?.width ?? customW;
  const targetH = selectedPreset?.height ?? customH;

  // Max canvas height — prevent portrait presets from making the canvas enormous
  const MAX_CANVAS_HEIGHT = 500;

  // Track container width for responsive canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Render the framing preview. Uses content bounds (not full preview dims)
  // to compute zoom/pan in the same coordinate space as the server export.
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !img) return;

    // Canvas size: fit target aspect ratio into available space
    const displayScale = Math.min(containerWidth / targetW, MAX_CANVAS_HEIGHT / targetH);
    const displayW = Math.round(targetW * displayScale);
    const displayH = Math.round(targetH * displayScale);
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, displayW, displayH);

    // Use content bounds to match server's auto-cropped reference frame.
    // Fallback to full image if bounds detection failed.
    const cLeft = bounds?.left ?? 0;
    const cTop = bounds?.top ?? 0;
    const cw = bounds?.width ?? img.naturalWidth;
    const ch = bounds?.height ?? img.naturalHeight;

    // Rotation math (negate to match server convention)
    const rad = (-rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));

    // Rotated content dimensions — matches server's scipy rotate(reshape=True)
    const rotW = Math.abs(rotation) > 0.01 ? cw * cos + ch * sin : cw;
    const rotH = Math.abs(rotation) > 0.01 ? cw * sin + ch * cos : ch;

    // Mirror server framing: baseScale fits content, cropZoom multiplies
    const baseScale = Math.min(displayW / rotW, displayH / rotH);
    const effectiveScale = baseScale * cropZoom;
    const scaledW = cw * effectiveScale;
    const scaledH = ch * effectiveScale;

    // Total dimensions after rotation at this scale
    const totalScaledW = Math.abs(rotation) > 0.01 ? scaledW * cos + scaledH * sin : scaledW;
    const totalScaledH = Math.abs(rotation) > 0.01 ? scaledW * sin + scaledH * cos : scaledH;

    // Pan offset — mirrors server's crop_center logic
    let xOff: number, yOff: number;
    if (totalScaledW > displayW) {
      xOff = -cropCenterX * (totalScaledW - displayW);
    } else {
      xOff = (displayW - totalScaledW) / 2;
    }
    if (totalScaledH > displayH) {
      yOff = -cropCenterY * (totalScaledH - displayH);
    } else {
      yOff = (displayH - totalScaledH) / 2;
    }

    ctx.save();
    ctx.translate(xOff + totalScaledW / 2, yOff + totalScaledH / 2);
    if (Math.abs(rotation) > 0.01) {
      ctx.rotate(rad);
    }
    // Draw only the content region from the preview (matching server auto-crop)
    ctx.drawImage(img, cLeft, cTop, cw, ch, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();

    // Dashed border overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0.5, 0.5, displayW - 1, displayH - 1);
  }, [targetW, targetH, rotation, cropZoom, cropCenterX, cropCenterY, containerWidth]);

  // Load preview image and detect content bounds
  useEffect(() => {
    if (!previewUrl) {
      imgRef.current = null;
      boundsRef.current = null;
      return;
    }
    const img = document.createElement('img');
    img.onload = () => {
      imgRef.current = img;
      boundsRef.current = detectContentBounds(img);
      drawCanvas();
    };
    img.src = previewUrl;
  }, [previewUrl, drawCanvas]);

  // Auto-fit when preset or rotation changes
  useEffect(() => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    const fit = computeAutoFit(bounds.width, bounds.height, targetW, targetH, rotation);
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- intentional: recompute framing when preset/rotation changes, no alternative without key-based remounting */
    setCropZoom(fit.zoom);
    setCropCenterX(fit.centerX);
    setCropCenterY(fit.centerY);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
  }, [targetW, targetH, rotation]);

  // Redraw on state changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Drag to pan handlers (pointer events for mouse + touch support)
  function handlePointerDown(e: React.PointerEvent) {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, cx: cropCenterX, cy: cropCenterY };
    wrapRef.current?.classList.add('grabbing');
    wrapRef.current?.setPointerCapture(e.pointerId);
  }

  useEffect(() => {
    function handlePointerMove(e: globalThis.PointerEvent) {
      if (!isDraggingRef.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      // Convert pixel drag to center offset (normalized 0-1)
      const sensitivity = 1.5 / (canvas.width * cropZoom);
      const newCX = Math.max(0, Math.min(1, dragStartRef.current.cx - dx * sensitivity));
      const newCY = Math.max(0, Math.min(1, dragStartRef.current.cy - dy * sensitivity));
      setCropCenterX(newCX);
      setCropCenterY(newCY);
    }

    function handlePointerUp() {
      isDraggingRef.current = false;
      wrapRef.current?.classList.remove('grabbing');
    }

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [cropZoom]);

  function handlePresetSelect(preset: WallpaperPreset) {
    setSelectedPreset(preset);
  }

  function handleCustom() {
    setSelectedPreset(null);
  }

  function handleExport() {
    onExport({
      width: targetW,
      height: targetH,
      format,
      rotationDegrees: rotation,
      cropCenterX,
      cropCenterY,
      cropZoom,
    });
  }

  return (
    <div className="export-framing">
      {/* Framing canvas — serves as the main preview */}
      <div className="export-framing-canvas-wrap" ref={wrapRef} onPointerDown={handlePointerDown}>
        {previewUrl ? (
          <canvas ref={canvasRef} className="export-framing-canvas" />
        ) : (
          <div className="export-framing-placeholder">No preview available</div>
        )}
        {isRegenerating && previewUrl && (
          <div className="export-framing-regenerating">Regenerating...</div>
        )}
      </div>

      {/* Zoom slider */}
      <div className="export-framing-zoom">
        <span className="export-framing-zoom-label">Zoom</span>
        <input
          type="range"
          className="export-framing-zoom-slider"
          min="1"
          max="5"
          step="0.1"
          value={cropZoom}
          onChange={(e) => setCropZoom(Number(e.target.value))}
          aria-label="Zoom level"
        />
        <span className="export-framing-zoom-value">{cropZoom.toFixed(1)}x</span>
      </div>

      {/* Resolution presets — compact single-flow grid */}
      <div className="export-framing-presets">
        <div className="export-framing-preset-row">
          {WALLPAPER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn-base export-framing-preset-btn${selectedPreset?.id === preset.id ? ' active' : ''}`}
              title={`${preset.category} — ${preset.width}×${preset.height}`}
              onClick={() => handlePresetSelect(preset)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={`btn-base export-framing-preset-btn${selectedPreset === null ? ' active' : ''}`}
            onClick={handleCustom}
          >
            Custom
          </button>
        </div>
        {selectedPreset === null && (
          <div className="export-framing-custom">
            <input
              type="number"
              className="export-framing-custom-input"
              value={customW}
              min={100}
              max={4096}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!isNaN(val)) setCustomW(Math.max(100, Math.min(4096, val)));
              }}
            />
            <span className="export-framing-custom-x">&times;</span>
            <input
              type="number"
              className="export-framing-custom-input"
              value={customH}
              min={100}
              max={4096}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!isNaN(val)) setCustomH(Math.max(100, Math.min(4096, val)));
              }}
            />
          </div>
        )}
        <div className="export-framing-resolution">
          {targetW} &times; {targetH}
        </div>
      </div>

      {/* Format + Export */}
      <div className="export-framing-actions">
        <div className="export-framing-format" role="group" aria-label="Output format">
          <button
            type="button"
            className={`btn-base export-framing-format-btn${format === 'png' ? ' active' : ''}`}
            onClick={() => setFormat('png')}
          >
            PNG
          </button>
          <button
            type="button"
            className={`btn-base export-framing-format-btn${format === 'jpeg' ? ' active' : ''}`}
            onClick={() => setFormat('jpeg')}
          >
            JPEG
          </button>
        </div>
        <button
          type="button"
          className="btn-base export-framing-export-btn"
          disabled={disabled || !previewUrl}
          onClick={handleExport}
        >
          Export
        </button>
      </div>
    </div>
  );
}
