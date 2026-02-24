import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import WcsGridOverlay from './WcsGridOverlay';
import { computeWcsGridLines, computeScaleBar } from '../utils/wcsGridUtils';

// Mock ResizeObserver which is not available in jsdom
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(_callback: (entries: any[]) => void) {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

vi.mock('../utils/wcsGridUtils', () => ({
  computeWcsGridLines: vi.fn(),
  computeScaleBar: vi.fn(),
}));

const mockWcs = {
  crpix1: 512,
  crpix2: 512,
  crval1: 150.0,
  crval2: 2.0,
  cdelt1: -0.0001,
  cdelt2: 0.0001,
  cd1_1: -0.0001,
  cd1_2: 0,
  cd2_1: 0,
  cd2_2: 0.0001,
  ctype1: 'RA---TAN',
  ctype2: 'DEC--TAN',
};

describe('WcsGridOverlay', () => {
  beforeEach(() => {
    vi.mocked(computeWcsGridLines).mockReset();
    vi.mocked(computeScaleBar).mockReset();
  });

  const renderOverlay = (props: Record<string, any> = {}) => {
    return render(
      <WcsGridOverlay
        wcs={mockWcs}
        imageWidth={1024}
        imageHeight={1024}
        scaleFactor={1}
        imageElement={null}
        visible={true}
        zoomScale={1}
        {...props}
      />
    );
  };

  it('returns null when no WCS params', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue(null);
    const { container } = renderOverlay({ wcs: null });
    expect(container.innerHTML).toBe('');
  });

  it('returns null when grid computation returns null', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue(null);
    const { container } = renderOverlay();
    expect(container.innerHTML).toBe('');
  });

  it('returns null when visible is false', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue(null);
    const { container } = renderOverlay({ visible: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders SVG when grid data is provided', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue({
      raLines: [
        {
          value: 150.0,
          points: [
            { x: 100, y: 100 },
            { x: 100, y: 900 },
          ],
        },
      ],
      decLines: [
        {
          value: 2.0,
          points: [
            { x: 100, y: 500 },
            { x: 900, y: 500 },
          ],
        },
      ],
      raLabels: [{ value: 150.0, x: 100, y: 10, formattedValue: '10h 00m 00s' }],
      decLabels: [{ value: 2.0, x: 10, y: 500, formattedValue: '+02\u00b0 00\' 00"' }],
    });
    vi.mocked(computeScaleBar).mockReturnValue(null);

    const { container } = renderOverlay();
    const svg = container.querySelector('svg.wcs-grid-overlay');
    expect(svg).toBeInTheDocument();
  });

  it('renders scale bar when scale bar data is provided', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue({
      label: '1 arcmin',
      widthPx: 100,
    });

    const { container } = renderOverlay();
    expect(container.querySelector('.wcs-scale-bar')).toBeInTheDocument();
    expect(container.querySelector('.wcs-scale-bar-label')).toHaveTextContent('1 arcmin');
  });

  it('does not render scale bar when scale bar data is null', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue({
      raLines: [],
      decLines: [],
      raLabels: [],
      decLabels: [],
    });
    vi.mocked(computeScaleBar).mockReturnValue(null);

    const { container } = renderOverlay();
    expect(container.querySelector('.wcs-scale-bar')).not.toBeInTheDocument();
  });

  it('passes correct args to computeWcsGridLines', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue(null);

    renderOverlay();
    expect(computeWcsGridLines).toHaveBeenCalledWith(mockWcs, 1024, 1024, 1);
  });

  it('does not call computeWcsGridLines when imageWidth is 0', () => {
    vi.mocked(computeWcsGridLines).mockReturnValue(null);
    vi.mocked(computeScaleBar).mockReturnValue(null);

    renderOverlay({ imageWidth: 0 });
    expect(computeWcsGridLines).not.toHaveBeenCalled();
  });
});
