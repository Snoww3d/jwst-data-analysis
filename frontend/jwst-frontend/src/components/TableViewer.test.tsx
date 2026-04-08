import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TableViewer from './TableViewer';
import type { TableInfoResponse, TableDataResponse, TableColumnInfo } from '../types/AnalysisTypes';

vi.mock('../services/analysisService', () => ({
  getTableInfo: vi.fn(),
  getTableData: vi.fn(),
}));

import { getTableInfo, getTableData } from '../services/analysisService';

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

const mockColumns: TableColumnInfo[] = [
  { name: 'RA', dtype: '1D', unit: 'deg', format: null, isArray: false, arrayShape: null },
  { name: 'DEC', dtype: '1D', unit: 'deg', format: null, isArray: false, arrayShape: null },
  { name: 'NAME', dtype: '20A', unit: null, format: null, isArray: false, arrayShape: null },
];

const mockTableInfo: TableInfoResponse = {
  fileName: 'test-table.fits',
  tableHdus: [
    {
      index: 1,
      name: 'CATALOG',
      hduType: 'BinTableHDU',
      nRows: 250,
      nColumns: 3,
      columns: mockColumns,
    },
  ],
};

const mockMultiHduInfo: TableInfoResponse = {
  fileName: 'multi-hdu.fits',
  tableHdus: [
    {
      index: 1,
      name: 'CATALOG',
      hduType: 'BinTableHDU',
      nRows: 250,
      nColumns: 3,
      columns: mockColumns,
    },
    {
      index: 2,
      name: 'ERRORS',
      hduType: 'BinTableHDU',
      nRows: 50,
      nColumns: 2,
      columns: mockColumns.slice(0, 2),
    },
  ],
};

const mockTableData: TableDataResponse = {
  hduIndex: 1,
  hduName: 'CATALOG',
  totalRows: 250,
  totalColumns: 3,
  page: 0,
  pageSize: 100,
  columns: mockColumns,
  rows: [
    { RA: 150.123, DEC: 2.456, NAME: 'NGC 1234' },
    { RA: 151.789, DEC: -0.5, NAME: null },
  ],
  sortColumn: null,
  sortDirection: null,
};

const mockEmptyTableData: TableDataResponse = {
  ...mockTableData,
  totalRows: 0,
  rows: [],
};

describe('TableViewer', () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<() => void>();
  });

  const defaultProps = {
    dataId: 'test-id',
    title: 'test-table.fits',
    isOpen: false,
    onClose: vi.fn<() => void>(),
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

  it('shows error message when getTableInfo rejects', async () => {
    vi.mocked(getTableInfo).mockRejectedValueOnce(new Error('Network error'));
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows fallback error message for non-Error rejections', async () => {
    vi.mocked(getTableInfo).mockRejectedValueOnce('something broke');
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load table info')).toBeInTheDocument();
    });
  });

  it('shows "No table data found" when tableHdus is empty', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce({ fileName: 'empty.fits', tableHdus: [] });
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('No table data found in this file.')).toBeInTheDocument();
    });
  });

  it('shows error when getTableData rejects', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockRejectedValueOnce(new Error('Table fetch failed'));
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('Table fetch failed')).toBeInTheDocument();
    });
  });

  it('renders table rows when data loads successfully', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('NGC 1234')).toBeInTheDocument();
    });
    // Column headers rendered
    expect(screen.getByText('RA')).toBeInTheDocument();
    expect(screen.getByText('DEC')).toBeInTheDocument();
    expect(screen.getByText('NAME')).toBeInTheDocument();
  });

  it('shows "No rows" when table has 0 rows', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockEmptyTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('No rows in this table.')).toBeInTheDocument();
    });
  });

  it('displays pagination info when data is loaded', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Showing 1/)).toBeInTheDocument();
      expect(screen.getByText(/of 250 rows/)).toBeInTheDocument();
    });
  });

  it('disables previous/first buttons on first page', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTitle('First page')).toBeDisabled();
      expect(screen.getByTitle('Previous page')).toBeDisabled();
    });
  });

  it('enables next/last buttons when not on last page', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTitle('Next page')).not.toBeDisabled();
      expect(screen.getByTitle('Last page')).not.toBeDisabled();
    });
  });

  it('disables next/last buttons on last page', async () => {
    const lastPageData: TableDataResponse = {
      ...mockTableData,
      totalRows: 50,
      page: 0,
      pageSize: 100,
    };
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(lastPageData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTitle('Next page')).toBeDisabled();
      expect(screen.getByTitle('Last page')).toBeDisabled();
    });
  });

  it('CSV export button disabled when no data loaded', () => {
    render(<TableViewer {...defaultProps} isOpen={true} />);
    expect(screen.getByTitle('Export current page as CSV').closest('button')).toBeDisabled();
  });

  it('CSV export button enabled when data is loaded', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTitle('Export current page as CSV').closest('button')).not.toBeDisabled();
    });
  });

  it('Escape key calls onClose', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('NGC 1234')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape key does not fire when focused on an input', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('NGC 1234')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search table...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('HDU selector appears when multiple HDUs exist', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockMultiHduInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Select table HDU')).toBeInTheDocument();
    });
  });

  it('HDU selector does not appear for single-HDU files', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('NGC 1234')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Select table HDU')).not.toBeInTheDocument();
  });

  it('displays em-dash for null cell values', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      // Second row has NAME: null, which renders as em-dash
      expect(screen.getByText('\u2014')).toBeInTheDocument();
    });
  });

  it('shows row stats in header after loading', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText(/250 rows × 3 columns/)).toBeInTheDocument();
    });
  });

  it('sort click sets ascending sort indicator', async () => {
    vi.mocked(getTableInfo).mockResolvedValueOnce(mockTableInfo);
    vi.mocked(getTableData).mockResolvedValueOnce(mockTableData);
    render(<TableViewer {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('RA')).toBeInTheDocument();
    });

    // Click RA header to sort ascending
    const raHeader = screen.getByText('RA').closest('th');
    fireEvent.click(raHeader!);

    // getTableData should be called again with sort params
    await waitFor(() => {
      expect(getTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          sortColumn: 'RA',
          sortDirection: 'asc',
        })
      );
    });
  });

  it('close button calls onClose', () => {
    render(<TableViewer {...defaultProps} isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close table viewer'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('overlay click calls onClose', () => {
    const { container } = render(<TableViewer {...defaultProps} isOpen={true} onClose={onClose} />);
    const overlay = container.querySelector('.table-viewer-overlay');
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
