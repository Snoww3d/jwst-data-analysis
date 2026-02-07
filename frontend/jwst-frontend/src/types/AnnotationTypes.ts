/**
 * Types for FITS image annotation tools.
 * Annotations are stored in FITS pixel coordinates and rendered
 * via coordinate conversion to screen space.
 */

/** The kind of annotation tool currently active */
export type AnnotationToolType = 'text' | 'arrow' | 'circle';

/** Preset colors available for annotations */
export type AnnotationColor = '#ffffff' | '#00e5ff' | '#ffeb3b' | '#ff5252' | '#69f0ae';

export const ANNOTATION_COLORS: { value: AnnotationColor; label: string }[] = [
  { value: '#ffffff', label: 'White' },
  { value: '#00e5ff', label: 'Cyan' },
  { value: '#ffeb3b', label: 'Yellow' },
  { value: '#ff5252', label: 'Red' },
  { value: '#69f0ae', label: 'Green' },
];

export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = '#00e5ff';

/** Base fields shared by all annotation types */
interface AnnotationBase {
  id: string;
  color: AnnotationColor;
  selected: boolean;
}

/** Text annotation: placed at a single FITS pixel coordinate */
export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  /** FITS pixel X where the text anchor sits */
  x: number;
  /** FITS pixel Y where the text anchor sits */
  y: number;
  text: string;
  /** Font size in screen pixels (does not scale with zoom) */
  fontSize: number;
}

/** Arrow annotation: line from start to end with arrowhead at end */
export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Circle/ellipse annotation: defined by center + radii in FITS pixels */
export interface CircleAnnotation extends AnnotationBase {
  type: 'circle';
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

/** Discriminated union of all annotation types */
export type Annotation = TextAnnotation | ArrowAnnotation | CircleAnnotation;
