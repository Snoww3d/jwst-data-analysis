import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CurvesEditor from './CurvesEditor';

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
  canvas: { width: 200, height: 200 },
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  shadowColor: '',
  shadowBlur: 0,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

describe('CurvesEditor', () => {
  const defaultProps = {
    controlPoints: [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ],
    onChange: vi.fn(),
    activePreset: null as null,
    onPresetChange: vi.fn(),
    onReset: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
  };

  it('renders the curves editor header', () => {
    render(<CurvesEditor {...defaultProps} />);
    expect(screen.getByText('Curves')).toBeInTheDocument();
  });

  it('renders preset buttons when not collapsed', () => {
    render(<CurvesEditor {...defaultProps} />);
    expect(screen.getByText('Linear')).toBeInTheDocument();
    expect(screen.getByText('Auto Contrast')).toBeInTheDocument();
    expect(screen.getByText('High Contrast')).toBeInTheDocument();
    expect(screen.getByText('Invert')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    render(<CurvesEditor {...defaultProps} collapsed={true} />);
    expect(screen.getByText('Curves')).toBeInTheDocument();
    expect(screen.queryByText('Linear')).not.toBeInTheDocument();
  });
});
