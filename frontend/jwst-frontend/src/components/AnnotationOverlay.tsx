import React, { useState, useCallback, useRef, useEffect, type RefCallback } from 'react';
import './AnnotationOverlay.css';
import type {
  Annotation,
  AnnotationToolType,
  AnnotationColor,
  TextAnnotation,
  ArrowAnnotation,
  CircleAnnotation,
} from '../types/AnnotationTypes';

interface AnnotationOverlayProps {
  /** Currently active annotation tool, or null if annotation mode is off */
  activeTool: AnnotationToolType | null;
  /** Current list of all annotations */
  annotations: Annotation[];
  /** Currently selected annotation color for new annotations */
  activeColor: AnnotationColor;
  /** Callback when a new annotation is created */
  onAnnotationAdd: (annotation: Annotation) => void;
  /** Callback when an annotation is selected (clicked on) */
  onAnnotationSelect: (id: string | null) => void;
  /** Pixel dimensions of the FITS image data */
  imageDataWidth: number;
  imageDataHeight: number;
  /** Reference to the displayed image element for coordinate mapping */
  imageElement: HTMLImageElement | null;
}

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface TextInputState {
  fitsX: number;
  fitsY: number;
  text: string;
}

let annotationIdCounter = 0;
const nextId = (): string => `ann-${++annotationIdCounter}-${Date.now()}`;

const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
  activeTool,
  annotations,
  activeColor,
  onAnnotationAdd,
  onAnnotationSelect,
  imageDataWidth,
  imageDataHeight,
  imageElement,
}) => {
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const svgObserverRef = useRef<ResizeObserver | null>(null);
  const [svgRect, setSvgRect] = useState<DOMRect | null>(null);
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
  const textInputRef = useRef<HTMLInputElement>(null);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [textInputState, setTextInputState] = useState<TextInputState | null>(null);

  // Auto-focus text input when it appears
  useEffect(() => {
    if (textInputState && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [textInputState]);

  // Clear transient state when tool changes (adjust state during render)
  const [prevActiveTool, setPrevActiveTool] = useState(activeTool);
  if (activeTool !== prevActiveTool) {
    setPrevActiveTool(activeTool);
    setDrawState(null);
    setTextInputState(null);
  }

  // Convert screen coordinates to FITS pixel coordinates
  const screenToFitsCoords = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } | null => {
      if (!imageElement) return null;
      const imgRect = imageElement.getBoundingClientRect();
      const relX = screenX - imgRect.left;
      const relY = screenY - imgRect.top;
      const fitsX = Math.round((relX / imgRect.width) * imageDataWidth);
      const fitsY = Math.round((relY / imgRect.height) * imageDataHeight);
      return { x: fitsX, y: fitsY };
    },
    [imageElement, imageDataWidth, imageDataHeight]
  );

  // Convert FITS pixel coordinates to screen coordinates for display
  const fitsToScreenCoords = useCallback(
    (fitsX: number, fitsY: number): { x: number; y: number } | null => {
      if (!imageElement || !svgRect) return null;
      const imgRect = imageElement.getBoundingClientRect();
      const screenX = (fitsX / imageDataWidth) * imgRect.width + imgRect.left - svgRect.left;
      const screenY = (fitsY / imageDataHeight) * imgRect.height + imgRect.top - svgRect.top;
      return { x: screenX, y: screenY };
    },
    [imageElement, imageDataWidth, imageDataHeight, svgRect]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!activeTool) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      if (activeTool === 'text') {
        // Place text input at click location
        setTextInputState({ fitsX: fits.x, fitsY: fits.y, text: '' });
        return;
      }

      // Start drawing arrow or circle
      onAnnotationSelect(null); // Deselect any selected annotation
      setDrawState({
        startX: fits.x,
        startY: fits.y,
        currentX: fits.x,
        currentY: fits.y,
      });
    },
    [activeTool, screenToFitsCoords, onAnnotationSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawState) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      setDrawState((prev) => (prev ? { ...prev, currentX: fits.x, currentY: fits.y } : null));
    },
    [drawState, screenToFitsCoords]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawState || !activeTool) return;
      e.preventDefault();
      e.stopPropagation();

      const fits = screenToFitsCoords(e.clientX, e.clientY);
      if (!fits) return;

      if (activeTool === 'arrow') {
        const dx = fits.x - drawState.startX;
        const dy = fits.y - drawState.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 5) {
          const arrow: ArrowAnnotation = {
            type: 'arrow',
            id: nextId(),
            startX: drawState.startX,
            startY: drawState.startY,
            endX: fits.x,
            endY: fits.y,
            color: activeColor,
            selected: false,
          };
          onAnnotationAdd(arrow);
        }
      } else if (activeTool === 'circle') {
        const x0 = Math.min(drawState.startX, fits.x);
        const y0 = Math.min(drawState.startY, fits.y);
        const x1 = Math.max(drawState.startX, fits.x);
        const y1 = Math.max(drawState.startY, fits.y);
        const rx = (x1 - x0) / 2;
        const ry = (y1 - y0) / 2;
        if (rx >= 3 && ry >= 3) {
          const circle: CircleAnnotation = {
            type: 'circle',
            id: nextId(),
            centerX: x0 + rx,
            centerY: y0 + ry,
            radiusX: rx,
            radiusY: ry,
            color: activeColor,
            selected: false,
          };
          onAnnotationAdd(circle);
        }
      }

      setDrawState(null);
    },
    [drawState, activeTool, screenToFitsCoords, activeColor, onAnnotationAdd]
  );

  const handleTextCommit = useCallback(() => {
    if (!textInputState || !textInputState.text.trim()) {
      setTextInputState(null);
      return;
    }

    const text: TextAnnotation = {
      type: 'text',
      id: nextId(),
      x: textInputState.fitsX,
      y: textInputState.fitsY,
      text: textInputState.text.trim(),
      fontSize: 14,
      color: activeColor,
      selected: false,
    };
    onAnnotationAdd(text);
    setTextInputState(null);
  }, [textInputState, activeColor, onAnnotationAdd]);

  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation(); // Prevent viewer shortcuts (Escape, arrows, etc.)
      if (e.key === 'Enter') {
        handleTextCommit();
      } else if (e.key === 'Escape') {
        setTextInputState(null);
      }
    },
    [handleTextCommit]
  );

  const handleAnnotationClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onAnnotationSelect(id);
    },
    [onAnnotationSelect]
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      // If clicking on SVG background (not an annotation), deselect
      if (e.target === svgNodeRef.current) {
        onAnnotationSelect(null);
      }
    },
    [onAnnotationSelect]
  );

  // Render a text annotation
  const renderTextAnnotation = (ann: TextAnnotation) => {
    const pos = fitsToScreenCoords(ann.x, ann.y);
    if (!pos) return null;

    return (
      <g
        key={ann.id}
        className="annotation-group"
        onClick={(e) => handleAnnotationClick(e, ann.id)}
      >
        <text
          x={pos.x}
          y={pos.y}
          fill={ann.color}
          fontSize={ann.fontSize}
          fontFamily="'Inter', sans-serif"
          fontWeight="600"
          stroke="rgba(0,0,0,0.7)"
          strokeWidth="3"
          paintOrder="stroke"
          className={ann.selected ? 'annotation-selected' : ''}
        >
          {ann.text}
        </text>
        {/* Invisible hit target for easier selection */}
        <text
          x={pos.x}
          y={pos.y}
          fontSize={ann.fontSize}
          fontFamily="'Inter', sans-serif"
          fontWeight="600"
          fill="transparent"
          stroke="transparent"
          strokeWidth="16"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        >
          {ann.text}
        </text>
      </g>
    );
  };

  // Render an arrow annotation
  const renderArrowAnnotation = (ann: ArrowAnnotation) => {
    const start = fitsToScreenCoords(ann.startX, ann.startY);
    const end = fitsToScreenCoords(ann.endX, ann.endY);
    if (!start || !end) return null;

    const markerId = `arrowhead-${ann.id}`;

    return (
      <g
        key={ann.id}
        className="annotation-group"
        onClick={(e) => handleAnnotationClick(e, ann.id)}
      >
        <defs>
          <marker id={markerId} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={ann.color} />
          </marker>
        </defs>
        {/* Invisible hit target */}
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="annotation-hit-target" />
        {/* Visible arrow */}
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={ann.color}
          strokeWidth={2}
          markerEnd={`url(#${markerId})`}
          className={ann.selected ? 'annotation-selected' : ''}
        />
      </g>
    );
  };

  // Render a circle/ellipse annotation
  const renderCircleAnnotation = (ann: CircleAnnotation) => {
    const center = fitsToScreenCoords(ann.centerX, ann.centerY);
    const edge = fitsToScreenCoords(ann.centerX + ann.radiusX, ann.centerY + ann.radiusY);
    if (!center || !edge) return null;

    const screenRx = Math.abs(edge.x - center.x);
    const screenRy = Math.abs(edge.y - center.y);

    return (
      <g
        key={ann.id}
        className="annotation-group"
        onClick={(e) => handleAnnotationClick(e, ann.id)}
      >
        {/* Invisible hit target */}
        <ellipse
          cx={center.x}
          cy={center.y}
          rx={screenRx}
          ry={screenRy}
          className="annotation-hit-target"
        />
        {/* Visible ellipse */}
        <ellipse
          cx={center.x}
          cy={center.y}
          rx={screenRx}
          ry={screenRy}
          fill="none"
          stroke={ann.color}
          strokeWidth={2}
          className={ann.selected ? 'annotation-selected' : ''}
        />
      </g>
    );
  };

  // Render the annotation being drawn (ghost shape)
  const renderDrawingGhost = () => {
    if (!drawState) return null;

    const start = fitsToScreenCoords(drawState.startX, drawState.startY);
    const end = fitsToScreenCoords(drawState.currentX, drawState.currentY);
    if (!start || !end) return null;

    if (activeTool === 'arrow') {
      return (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={activeColor}
          strokeWidth={2}
          className="annotation-drawing"
        />
      );
    }

    if (activeTool === 'circle') {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      return (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          fill="none"
          stroke={activeColor}
          strokeWidth={2}
          className="annotation-drawing"
        />
      );
    }

    return null;
  };

  // Render text input foreignObject
  const renderTextInput = () => {
    if (!textInputState) return null;

    const pos = fitsToScreenCoords(textInputState.fitsX, textInputState.fitsY);
    if (!pos) return null;

    return (
      <foreignObject x={pos.x} y={pos.y - 20} width="180" height="36">
        <input
          ref={textInputRef}
          className="annotation-text-input"
          type="text"
          placeholder="Type label..."
          value={textInputState.text}
          onChange={(e) =>
            setTextInputState((prev) => (prev ? { ...prev, text: e.target.value } : null))
          }
          onKeyDown={handleTextKeyDown}
          onBlur={handleTextCommit}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        />
      </foreignObject>
    );
  };

  const renderAnnotation = (ann: Annotation) => {
    switch (ann.type) {
      case 'text':
        return renderTextAnnotation(ann);
      case 'arrow':
        return renderArrowAnnotation(ann);
      case 'circle':
        return renderCircleAnnotation(ann);
    }
  };

  // Don't render overlay at all if no annotations and no tool active
  if (!activeTool && annotations.length === 0 && !textInputState) return null;

  return (
    <svg
      ref={svgCallbackRef}
      className="annotation-overlay"
      onMouseDown={activeTool ? handleMouseDown : undefined}
      onMouseMove={activeTool ? handleMouseMove : undefined}
      onMouseUp={activeTool ? handleMouseUp : undefined}
      onClick={handleSvgClick}
      style={{
        cursor: activeTool ? 'crosshair' : 'default',
        pointerEvents: activeTool ? 'auto' : 'none',
      }}
    >
      {annotations.map(renderAnnotation)}
      {renderDrawingGhost()}
      {renderTextInput()}
    </svg>
  );
};

export default AnnotationOverlay;
