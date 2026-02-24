import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HistogramPanel from './HistogramPanel';

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
  canvas: { width: 300, height: 100 },
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('HistogramPanel', () => {
  it('renders the panel header with default title', () => {
    render(<HistogramPanel histogram={null} />);
    expect(screen.getByText('Histogram')).toBeInTheDocument();
  });

  it('renders with custom title', () => {
    render(<HistogramPanel histogram={null} title="Custom Histogram" />);
    expect(screen.getByText('Custom Histogram')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<HistogramPanel histogram={null} loading={true} />);
    expect(screen.getByText('Loading histogram...')).toBeInTheDocument();
  });

  it('shows empty state when no histogram data', () => {
    render(<HistogramPanel histogram={null} />);
    expect(screen.getByText('No histogram data available')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    render(<HistogramPanel histogram={null} collapsed={true} />);
    expect(screen.getByText('Histogram')).toBeInTheDocument();
    expect(screen.queryByText('No histogram data available')).not.toBeInTheDocument();
  });
});
