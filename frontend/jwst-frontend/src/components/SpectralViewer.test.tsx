import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpectralViewer from './SpectralViewer';

vi.mock('react-plotly.js', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="plotly-chart" />,
}));

vi.mock('../services/analysisService', () => ({
  getSpectralData: vi.fn(),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('SpectralViewer', () => {
  const defaultProps = {
    dataId: 'test-id',
    title: 'test.fits',
    isOpen: false,
    onClose: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SpectralViewer {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the viewer with loading state when isOpen is true', () => {
    render(<SpectralViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByText('test.fits')).toBeInTheDocument();
    expect(screen.getByLabelText('Close spectral viewer')).toBeInTheDocument();
  });
});
