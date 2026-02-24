import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import RegionSelector from './RegionSelector';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('RegionSelector', () => {
  const defaultProps = {
    mode: null as null,
    onRegionComplete: vi.fn(),
    onClear: vi.fn(),
    imageDataWidth: 1024,
    imageDataHeight: 1024,
    imageElement: null,
  };

  it('renders nothing when mode is null and no completed region', () => {
    const { container } = render(<RegionSelector {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders SVG overlay when mode is rectangle', () => {
    const { container } = render(<RegionSelector {...defaultProps} mode="rectangle" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.classList.contains('region-selector-overlay')).toBe(true);
  });

  it('renders SVG overlay when mode is ellipse', () => {
    const { container } = render(<RegionSelector {...defaultProps} mode="ellipse" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
