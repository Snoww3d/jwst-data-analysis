import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImageComparisonViewer from './ImageComparisonViewer';

// Mock fetch for image loading
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    })
  )
);

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('ImageComparisonViewer', () => {
  const defaultProps = {
    imageA: { dataId: 'a', title: 'Image A' },
    imageB: { dataId: 'b', title: 'Image B' },
    isOpen: false,
    onClose: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ImageComparisonViewer {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the viewer when isOpen is true', () => {
    render(<ImageComparisonViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByText('Image A')).toBeInTheDocument();
    expect(screen.getByText('Image B')).toBeInTheDocument();
  });

  it('renders comparison mode buttons when open', () => {
    render(<ImageComparisonViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByText('Blink')).toBeInTheDocument();
    expect(screen.getByText('Side by Side')).toBeInTheDocument();
    expect(screen.getByText('Overlay')).toBeInTheDocument();
  });
});
