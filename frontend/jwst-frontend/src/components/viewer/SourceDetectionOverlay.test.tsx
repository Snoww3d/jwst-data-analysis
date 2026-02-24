import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SourceDetectionOverlay from './SourceDetectionOverlay';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('SourceDetectionOverlay', () => {
  const defaultProps = {
    sources: [],
    imageElement: null,
    imageDataWidth: 1024,
    imageDataHeight: 1024,
    scaleFactor: 1,
    visible: false,
  };

  it('renders nothing when not visible', () => {
    const { container } = render(<SourceDetectionOverlay {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when visible but no sources', () => {
    const { container } = render(<SourceDetectionOverlay {...defaultProps} visible={true} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when visible with sources but no imageElement', () => {
    const sources = [{ id: 1, xcentroid: 100, ycentroid: 100 }];
    const { container } = render(
      <SourceDetectionOverlay {...defaultProps} visible={true} sources={sources} />
    );
    expect(container.innerHTML).toBe('');
  });
});
