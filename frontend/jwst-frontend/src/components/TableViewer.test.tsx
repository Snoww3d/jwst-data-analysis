import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TableViewer from './TableViewer';

vi.mock('../services/analysisService', () => ({
  getTableInfo: vi.fn(),
  getTableData: vi.fn(),
}));

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('TableViewer', () => {
  const defaultProps = {
    dataId: 'test-id',
    title: 'test-table.fits',
    isOpen: false,
    onClose: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<TableViewer {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the viewer when isOpen is true', () => {
    render(<TableViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByText('test-table.fits')).toBeInTheDocument();
    expect(screen.getByLabelText('Close table viewer')).toBeInTheDocument();
  });

  it('renders the search input when open', () => {
    render(<TableViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByPlaceholderText('Search table...')).toBeInTheDocument();
  });
});
