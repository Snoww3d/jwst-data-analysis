/**
 * Hand-written typings for the subset of Aladin Lite v3 this app uses
 * (`import type { AladinStatic, … } from '../types/aladin-lite'`); also
 * declares `window.A`, which the runtime loader resolves.
 *
 * Aladin is loaded at runtime from a script tag (`lib/loadAladin.ts`), not
 * imported from npm (LGPL boundary — see docs/plans/features/search-v2-skymap.md),
 * so there is no package to pull types from. Only what `SkyMap.tsx` calls is
 * declared; extend here when you use more of the API, and verify the member
 * against the pinned bundle first.
 */

export interface AladinOptions {
  survey?: string;
  fov?: number;
  target?: string;
  cooFrame?: 'ICRS' | 'ICRSd' | 'galactic' | 'equatorial';
  projection?: string;
  showReticle?: boolean;
  showLayersControl?: boolean;
  showFullscreenControl?: boolean;
  showGotoControl?: boolean;
  showZoomControl?: boolean;
  showSettingsControl?: boolean;
  showShareControl?: boolean;
  showSimbadPointerControl?: boolean;
  showCooGridControl?: boolean;
  showStatusBar?: boolean;
  showFrame?: boolean;
  showFov?: boolean;
  showCooLocation?: boolean;
  showProjectionControl?: boolean;
  showContextMenu?: boolean;
  showCatalog?: boolean;
  backgroundColor?: string;
  mode?: 'dark' | 'light';
}

export interface ShapeOptions {
  color?: string;
  fillColor?: string;
  lineWidth?: number;
  opacity?: number;
  selectionColor?: string;
  hoverColor?: string;
}

/** A footprint shape (Polyline/Circle) from `A.footprintsFromSTCS`. */
export interface Footprint {
  /** Open for our own use: Aladin never reads it. */
  data?: Record<string, unknown>;
  setColor(color: string): void;
  setLineWidth(width: number): void;
  setSelectionColor(color: string): void;
  setHoverColor(color: string): void;
  select(): void;
  deselect(): void;
  hover(): void;
  unhover(): void;
  show(): void;
  hide(): void;
  isFootprint(): boolean;
}

export interface GraphicOverlay {
  addFootprints(footprints: Footprint | Footprint[]): void;
  add(footprint: Footprint, requestRedraw?: boolean): void;
  removeAll(): void;
  reportChange(): void;
  show(): void;
  hide(): void;
  remove(footprint: Footprint): void;
}

export interface MocOptions {
  color?: string;
  fillColor?: string;
  opacity?: number;
  lineWidth?: number;
  name?: string;
  /** Draw the cell perimeters. */
  perimeter?: boolean;
  /** Fill the cells. */
  fill?: boolean;
  /** Draw cell edges. */
  edge?: boolean;
}

export interface ImageLayerOptions {
  name?: string;
  successCallback?: (layer: ImageLayer) => void;
  errorCallback?: (err: unknown) => void;
}

/** An image survey (HiPS) layer from `A.HiPS`. */
export interface ImageLayer {
  readonly id?: string;
}

export interface Moc {
  show(): void;
  hide(): void;
  setColor?(color: string): void;
}

export interface PositionEvent {
  ra: number;
  dec: number;
  /** Did the position change because of a user drag? */
  dragging?: boolean;
}

export interface ClickEvent {
  ra: number | null;
  dec: number | null;
  x: number;
  y: number;
  isDragging?: boolean;
}

export type EventName =
  | 'select'
  | 'objectClicked'
  | 'objectHovered'
  | 'objectHoveredStop'
  | 'footprintClicked'
  | 'footprintHovered'
  | 'positionChanged'
  | 'zoomChanged'
  | 'click'
  | 'mouseMove'
  | 'fullScreenToggled'
  | 'resizeChanged'
  | 'layerChanged';

export interface AladinInstance {
  on(
    event: 'objectClicked',
    cb: (obj: Footprint | null, xy?: { x: number; y: number }) => void
  ): void;
  on(event: 'objectHovered', cb: (obj: Footprint, xy?: { x: number; y: number }) => void): void;
  on(event: 'objectHoveredStop', cb: (obj: Footprint, xy?: { x: number; y: number }) => void): void;
  on(event: 'positionChanged', cb: (pos: PositionEvent) => void): void;
  on(event: 'zoomChanged', cb: (fov: number) => void): void;
  on(event: 'click', cb: (ev: ClickEvent) => void): void;
  on(event: EventName, cb: (...args: never[]) => void): void;
  addOverlay(overlay: GraphicOverlay): void;
  removeOverlay(overlay: GraphicOverlay): void;
  addMOC(moc: Moc): void;
  removeLayers?(): void;
  gotoRaDec(ra: number, dec: number): void;
  setFoV(fov: number): void;
  getFov(): [number, number];
  getRaDec(): [number, number];
  getSize(): [number, number];
  setBaseImageLayer(survey: string | ImageLayer): void;
  setProjection(projection: string): void;
  /** Re-read the container size after a layout change. */
  view?: { fixLayoutDimensions?: () => void; requestRedraw?: () => void };
}

export interface AladinStatic {
  /** Resolves once the WebGL/wasm core is ready; rejects without WebGL2. */
  init: Promise<void>;
  aladin(target: string | HTMLElement, options?: AladinOptions): AladinInstance;
  graphicOverlay(options?: ShapeOptions & { name?: string }): GraphicOverlay;
  footprintsFromSTCS(stcs: string, options?: ShapeOptions): Footprint[];
  MOCFromJSON(
    json: Record<string, number[]>,
    options?: MocOptions,
    onSuccess?: () => void,
    onError?: (err: unknown) => void
  ): Moc;
  HiPS(idOrUrl: string, options?: ImageLayerOptions): ImageLayer;
  polygon(raDecArray: [number, number][], options?: ShapeOptions): Footprint;
  circle(ra: number, dec: number, radiusDeg: number, options?: ShapeOptions): Footprint;
}

declare global {
  interface Window {
    A?: AladinStatic;
  }
}

export {};
