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

const PRESET_CATEGORIES = ['Desktop', 'Phone', 'Tablet', 'Social'] as const;

/**
 * Scan the canvas to find the bounding box of non-black content,
 * then compute optimal zoom + center to fill the target aspect ratio.
 */
function computeAutoFit(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
  rotation: number
): { zoom: number; centerX: number; centerY: number } {
  // Detect content bounds via a small offscreen canvas
  const sampleSize = 200;
  const scale = Math.min(sampleSize / img.naturalWidth, sampleSize / img.naturalHeight);
  const sw = Math.round(img.naturalWidth * scale);
  const sh = Math.round(img.naturalHeight * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = sw;
  offscreen.height = sh;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return { zoom: 1.0, centerX: 0.5, centerY: 0.5 };

  // Apply rotation to detect rotated content bounds (negate to match server convention)
  if (Math.abs(rotation) > 0.01) {
    const rad = (-rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rw = Math.round(sw * cos + sh * sin);
    const rh = Math.round(sw * sin + sh * cos);
    offscreen.width = rw;
    offscreen.height = rh;
    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  } else {
    ctx.drawImage(img, 0, 0, sw, sh);
  }

  const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
  const { data } = imageData;
  let top = offscreen.height,
    left = offscreen.width,
    bottom = 0,
    right = 0;

  for (let y = 0; y < offscreen.height; y++) {
    for (let x = 0; x < offscreen.width; x++) {
      const i = (y * offscreen.width + x) * 4;
      if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (bottom <= top || right <= left) {
    return { zoom: 1.0, centerX: 0.5, centerY: 0.5 };
  }

  const contentW = right - left + 1;
  const contentH = bottom - top + 1;
  const contentCenterX = (left + right) / 2 / offscreen.width;
  const contentCenterY = (top + bottom) / 2 / offscreen.height;

  // Compute zoom so content fills the target aspect ratio
  const targetAspect = targetW / targetH;
  const contentAspect = contentW / contentH;

  let zoom: number;
  if (contentAspect > targetAspect) {
    // Content is wider than target — zoom to fit width
    zoom = offscreen.width / contentW;
  } else {
    // Content is taller than target — zoom to fit height
    zoom = offscreen.height / contentH;
  }

  // Clamp zoom to reasonable range
  zoom = Math.max(1.0, Math.min(zoom, 3.0));

  return { zoom, centerX: contentCenterX, centerY: contentCenterY };
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
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(280);

  const targetW = selectedPreset?.width ?? customW;
  const targetH = selectedPreset?.height ?? customH;

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

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    // Canvas size: fit target aspect ratio into available container width
    const maxDisplayW = containerWidth;
    const displayScale = Math.min(maxDisplayW / targetW, maxDisplayW / targetH);
    const displayW = Math.round(targetW * displayScale);
    const displayH = Math.round(targetH * displayScale);
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, displayW, displayH);

    // Compute image placement (mirrors server-side logic)
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    // Negate rotation: CSS/canvas rotate is CCW-positive, server negates to match CW-positive UI
    const rad = (-rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = imgW * cos + imgH * sin;
    const rotH = imgW * sin + imgH * cos;

    const baseScale = Math.min(displayW / rotW, displayH / rotH);
    const effectiveScale = baseScale * cropZoom;
    const scaledW = imgW * effectiveScale;
    const scaledH = imgH * effectiveScale;

    // Pan offset — compute total dimensions after rotation
    const totalScaledW = Math.abs(rotation) > 0.01 ? scaledW * cos + scaledH * sin : scaledW;
    const totalScaledH = Math.abs(rotation) > 0.01 ? scaledW * sin + scaledH * cos : scaledH;

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
    ctx.drawImage(img, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();

    // Dashed border overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0.5, 0.5, displayW - 1, displayH - 1);
  }, [targetW, targetH, rotation, cropZoom, cropCenterX, cropCenterY, containerWidth]);

  // Load preview image
  useEffect(() => {
    if (!previewUrl) {
      imgRef.current = null;
      return;
    }
    const img = document.createElement('img');
    img.onload = () => {
      imgRef.current = img;
      drawCanvas();
    };
    img.src = previewUrl;
  }, [previewUrl, drawCanvas]);

  // Auto-fit when preset or rotation changes
  useEffect(() => {
    if (!imgRef.current) return;
    const fit = computeAutoFit(imgRef.current, targetW, targetH, rotation);
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

  // Group presets by category
  const presetsByCategory = PRESET_CATEGORIES.map((cat) => ({
    category: cat,
    presets: WALLPAPER_PRESETS.filter((p) => p.category === cat),
  }));

  return (
    <div className="export-framing">
      <h4 className="export-framing-header">Export</h4>

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

      {/* Resolution presets */}
      <div className="export-framing-presets">
        {presetsByCategory.map(({ category, presets }) => (
          <div key={category} className="export-framing-preset-category">
            <span className="export-framing-preset-label">{category}</span>
            <div className="export-framing-preset-row">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`btn-base export-framing-preset-btn${selectedPreset?.id === preset.id ? ' active' : ''}`}
                  title={`${preset.width}×${preset.height}`}
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Custom */}
        <div className="export-framing-preset-category">
          <span className="export-framing-preset-label">Custom</span>
          <div className="export-framing-custom">
            <button
              type="button"
              className={`btn-base export-framing-preset-btn${selectedPreset === null ? ' active' : ''}`}
              onClick={handleCustom}
            >
              Custom
            </button>
            {selectedPreset === null && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Resolution display */}
      <div className="export-framing-resolution">
        {targetW} &times; {targetH}
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
