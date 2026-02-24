import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ComparisonImagePicker from './ComparisonImagePicker';

vi.mock('../config/api', () => ({
  API_BASE_URL: 'http://test',
}));

describe('ComparisonImagePicker', () => {
  const defaultProps = {
    allImages: [],
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders the picker with both columns', () => {
    render(<ComparisonImagePicker {...defaultProps} />);
    expect(screen.getByText('Select Images to Compare')).toBeInTheDocument();
  });

  it('renders the compare button', () => {
    render(<ComparisonImagePicker {...defaultProps} />);
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });
});
