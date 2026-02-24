import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageSelectionStep } from './ImageSelectionStep';

describe('ImageSelectionStep', () => {
  const defaultProps = {
    allImages: [],
    selectedIds: new Set<string>(),
    onSelectionChange: vi.fn(),
  };

  it('renders the step header', () => {
    render(<ImageSelectionStep {...defaultProps} />);
    expect(screen.getByText('Select Images')).toBeInTheDocument();
  });

  it('renders empty state when no images', () => {
    render(<ImageSelectionStep {...defaultProps} />);
    expect(screen.getByText('No image files available.')).toBeInTheDocument();
  });

  it('renders selection count', () => {
    render(<ImageSelectionStep {...defaultProps} />);
    expect(screen.getByText('0 selected (min 3)')).toBeInTheDocument();
  });

  it('renders select all and clear buttons', () => {
    render(<ImageSelectionStep {...defaultProps} />);
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear Selection')).toBeInTheDocument();
  });
});
