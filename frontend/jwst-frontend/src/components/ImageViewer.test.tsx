import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImageViewer from './ImageViewer';

// Mock canvas
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  setLineDash: vi.fn(),
  canvas: { width: 800, height: 600 },
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  shadowColor: '',
  shadowBlur: 0,
  font: '',
  textAlign: '',
  imageSmoothingEnabled: true,
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,');
HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb?.(new Blob()));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

// Mock fetch for image loading
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      blob: () => Promise.resolve(new Blob()),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      headers: new globalThis.Headers(),
    })
  )
);

// Mock child components
vi.mock('./StretchControls', () => ({
  default: () => <div data-testid="stretch-controls" />,
}));

vi.mock('./HistogramPanel', () => ({
  default: () => <div data-testid="histogram-panel" />,
}));

vi.mock('./ExportOptionsPanel', () => ({
  default: () => <div data-testid="export-options" />,
}));

vi.mock('./CubeNavigator', () => ({
  default: () => <div data-testid="cube-navigator" />,
}));

vi.mock('./RegionSelector', () => ({
  default: () => <div data-testid="region-selector" />,
}));

vi.mock('./RegionStatisticsPanel', () => ({
  default: () => <div data-testid="region-stats" />,
}));

vi.mock('./CurvesEditor', () => ({
  default: () => <div data-testid="curves-editor" />,
}));

vi.mock('./AnnotationOverlay', () => ({
  default: () => <div data-testid="annotation-overlay" />,
}));

vi.mock('./WcsGridOverlay', () => ({
  default: () => <div data-testid="wcs-grid-overlay" />,
}));

vi.mock('./viewer/SmoothingControls', () => ({
  default: () => <div data-testid="smoothing-controls" />,
}));

vi.mock('./viewer/SourceDetectionOverlay', () => ({
  default: () => <div data-testid="source-detection-overlay" />,
}));

vi.mock('./viewer/SourceDetectionPanel', () => ({
  default: () => <div data-testid="source-detection-panel" />,
}));

vi.mock('../services/jwstDataService', () => ({
  jwstDataService: {
    getPreview: vi.fn(),
    getPixelData: vi.fn(),
    exportImage: vi.fn(),
    getCubeInfo: vi.fn(),
    getPreviewUrl: vi.fn(() => 'http://test/preview'),
  },
}));

vi.mock('../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    getBlob: vi.fn(() => Promise.resolve(new Blob())),
  },
}));

vi.mock('../services/analysisService', () => ({
  getRegionStatistics: vi.fn(),
  detectSources: vi.fn(),
}));

describe('ImageViewer', () => {
  const defaultProps = {
    dataId: '507f1f77bcf86cd799439011',
    title: 'test-image.fits',
    onClose: vi.fn(),
    isOpen: false,
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ImageViewer {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the viewer when isOpen is true', () => {
    render(<ImageViewer {...defaultProps} isOpen={true} />);
    // Breadcrumb shows default target name when no metadata loaded
    expect(screen.getByText('Unknown Target')).toBeInTheDocument();
  });
});
