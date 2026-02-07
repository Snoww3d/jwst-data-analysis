import React, { useRef, useEffect, useCallback, useState } from 'react';
import './CurvesEditor.css';
import type { CurveControlPoint, CurvePresetName } from '../types/CurvesTypes';
import { generateLUT, CURVE_PRESETS } from '../utils/curvesUtils';

interface CurvesEditorProps {
  controlPoints: CurveControlPoint[];
  onChange: (points: CurveControlPoint[]) => void;
  activePreset: CurvePresetName | null;
  onPresetChange: (preset: CurvePresetName) => void;
  onReset: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// Canvas layout constants
const CANVAS_SIZE = 200;
const MARGIN = 8;
const PLOT_SIZE = CANVAS_SIZE - 2 * MARGIN;
const POINT_RADIUS = 6;
const POINT_HIT_RADIUS = 12;

// Convert curve-space (0-1) to canvas pixel coordinates
function toCanvasX(input: number): number {
  return MARGIN + input * PLOT_SIZE;
}
function toCanvasY(output: number): number {
  return MARGIN + (1 - output) * PLOT_SIZE;
}
// Convert canvas pixel coordinates to curve-space (0-1)
function fromCanvasX(px: number): number {
  return Math.max(0, Math.min(1, (px - MARGIN) / PLOT_SIZE));
}
function fromCanvasY(py: number): number {
  return Math.max(0, Math.min(1, 1 - (py - MARGIN) / PLOT_SIZE));
}

// SVG Icons
const Icons = {
  Curves: () => (
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
      <path d="M3 20 Q 8 4, 12 12 T 21 4" />
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
  Reset: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 4 1 10 7 10"></polyline>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
    </svg>
  ),
};

const PRESET_LIST: CurvePresetName[] = ['linear', 'auto_contrast', 'high_contrast', 'invert'];

const CurvesEditor: React.FC<CurvesEditorProps> = ({
  controlPoints,
  onChange,
  activePreset,
  onPresetChange,
  onReset,
  collapsed,
  onToggleCollapse,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Get sorted points for rendering
  const sortedPoints = [...controlPoints].sort((a, b) => a.input - b.input);

  // Draw the curves editor canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set actual pixel dimensions (CSS handles display size via aspect-ratio)
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(MARGIN, MARGIN, PLOT_SIZE, PLOT_SIZE);

    // Grid lines (25%, 50%, 75%)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const x = toCanvasX(frac);
      const y = toCanvasY(frac);
      ctx.beginPath();
      ctx.moveTo(x, MARGIN);
      ctx.lineTo(x, MARGIN + PLOT_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MARGIN, y);
      ctx.lineTo(MARGIN + PLOT_SIZE, y);
      ctx.stroke();
    }

    // Identity diagonal (reference line)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), toCanvasY(0));
    ctx.lineTo(toCanvasX(1), toCanvasY(1));
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the interpolated curve using the LUT for accuracy
    const lut = generateLUT(sortedPoints);
    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = toCanvasX(i / 255);
      const y = toCanvasY(lut[i] / 255);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw control points
    for (let i = 0; i < sortedPoints.length; i++) {
      const p = sortedPoints[i];
      const cx = toCanvasX(p.input);
      const cy = toCanvasY(p.output);
      const isActive = i === draggingIndex;
      const radius = isActive ? POINT_RADIUS + 2 : POINT_RADIUS;

      // Glow for active point
      if (isActive) {
        ctx.shadowColor = '#4db8ff';
        ctx.shadowBlur = 8;
      }

      ctx.fillStyle = '#4db8ff';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
  }, [sortedPoints, draggingIndex]);

  useEffect(() => {
    if (!collapsed) {
      drawCanvas();
    }
  }, [collapsed, drawCanvas]);

  // Get mouse position in canvas coordinates, accounting for CSS scaling
  const getCanvasPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  // Find the control point index nearest to a canvas position (within hit radius)
  const findNearestPoint = useCallback(
    (canvasX: number, canvasY: number): number | null => {
      let bestIdx: number | null = null;
      let bestDist = POINT_HIT_RADIUS;
      for (let i = 0; i < sortedPoints.length; i++) {
        const px = toCanvasX(sortedPoints[i].input);
        const py = toCanvasY(sortedPoints[i].output);
        const dist = Math.sqrt((canvasX - px) ** 2 + (canvasY - py) ** 2);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return bestIdx;
    },
    [sortedPoints]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return; // Left click only
      const pos = getCanvasPos(e);
      const idx = findNearestPoint(pos.x, pos.y);
      if (idx !== null) {
        setDraggingIndex(idx);
      }
    },
    [getCanvasPos, findNearestPoint]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (draggingIndex === null) return;

      const pos = getCanvasPos(e);
      const newInput = fromCanvasX(pos.x);
      const newOutput = fromCanvasY(pos.y);

      const newPoints = sortedPoints.map((p, i) => {
        if (i !== draggingIndex) return { ...p };

        // Endpoints: lock input at 0 or 1, only allow output change
        if (i === 0) {
          return { input: sortedPoints[0].input, output: newOutput };
        }
        if (i === sortedPoints.length - 1) {
          return { input: sortedPoints[sortedPoints.length - 1].input, output: newOutput };
        }

        // Interior points: constrain input between neighbors
        const minInput = sortedPoints[i - 1].input + 0.01;
        const maxInput = sortedPoints[i + 1].input - 0.01;
        return {
          input: Math.max(minInput, Math.min(maxInput, newInput)),
          output: newOutput,
        };
      });

      onChange(newPoints);
    },
    [draggingIndex, sortedPoints, getCanvasPos, onChange]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  // Double-click: add a new control point
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);

      // Don't add if too close to an existing point
      if (findNearestPoint(pos.x, pos.y) !== null) return;

      const newInput = fromCanvasX(pos.x);
      const newOutput = fromCanvasY(pos.y);

      const newPoints = [...sortedPoints, { input: newInput, output: newOutput }];
      newPoints.sort((a, b) => a.input - b.input);
      onChange(newPoints);
    },
    [getCanvasPos, findNearestPoint, sortedPoints, onChange]
  );

  // Right-click: remove a control point (min 2 points enforced)
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (sortedPoints.length <= 2) return;

      const pos = getCanvasPos(e);
      const idx = findNearestPoint(pos.x, pos.y);
      if (idx === null) return;

      // Don't remove the first or last endpoint
      if (idx === 0 || idx === sortedPoints.length - 1) return;

      const newPoints = sortedPoints.filter((_, i) => i !== idx);
      onChange(newPoints);
    },
    [sortedPoints, getCanvasPos, findNearestPoint, onChange]
  );

  return (
    <div className={`curves-editor ${collapsed ? 'collapsed' : ''}`}>
      <div className="curves-editor-header" onClick={onToggleCollapse}>
        <div className="curves-header-left">
          <Icons.Curves />
          <span className="curves-title">Curves</span>
        </div>
        <div className="curves-header-right">
          {!collapsed && (
            <button
              className="btn-reset"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              title="Reset to linear"
            >
              <Icons.Reset />
            </button>
          )}
          <span className="collapse-icon">
            {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="curves-editor-body">
          <canvas
            ref={canvasRef}
            className="curves-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          />

          <div className="curves-presets">
            {PRESET_LIST.map((preset) => (
              <button
                key={preset}
                className={`curves-preset-btn ${activePreset === preset ? 'active' : ''}`}
                onClick={() => onPresetChange(preset)}
                title={CURVE_PRESETS[preset].description}
              >
                {CURVE_PRESETS[preset].label}
              </button>
            ))}
          </div>

          <div className="curves-hint">
            Drag points. Double-click to add. Right-click to remove.
          </div>
        </div>
      )}
    </div>
  );
};

export default CurvesEditor;
