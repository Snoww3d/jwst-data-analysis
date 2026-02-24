import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { JwstDataModel } from '../../types/JwstDataTypes';
import LineageFileCard from './LineageFileCard';

vi.mock('../../utils/fitsUtils', () => ({
  getFitsFileInfo: (name: string) => {
    if (name.includes('_cal'))
      return { type: 'image', label: 'CAL', viewable: true, description: 'Calibrated image' };
    if (name.includes('_cat'))
      return { type: 'table', label: 'CAT', viewable: false, description: 'Source catalog' };
    if (name.includes('_x1d'))
      return { type: 'table', label: 'X1D', viewable: false, description: '1D spectrum' };
    return { type: 'unknown', label: 'FITS', viewable: true, description: 'FITS file' };
  },
  isSpectralFile: (name: string) => name.includes('_x1d'),
}));

vi.mock('../../utils/statusUtils', () => ({
  getStatusColor: (status: string) => (status === 'completed' ? 'green' : 'gray'),
}));

vi.mock('../../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));

vi.mock('../icons/DashboardIcons', () => ({
  TelescopeIcon: () => <span data-testid="telescope-icon" />,
  ImageIcon: () => <span data-testid="image-icon" />,
  TableIcon: () => <span data-testid="table-icon" />,
  CheckIcon: () => <span data-testid="check-icon" />,
  PlusIcon: () => <span data-testid="plus-icon" />,
}));

const mockItem: JwstDataModel = {
  id: '507f1f77bcf86cd799439011',
  fileName: 'test_cal.fits',
  dataType: 'image',
  fileSize: 5242880,
  processingStatus: 'completed',
  uploadDate: '2026-01-01T00:00:00Z',
  tags: ['nircam'],
  description: 'Test description',
  isArchived: false,
  hasThumbnail: true,
  imageInfo: {
    width: 2048,
    height: 2048,
    filter: 'F444W',
    observationDate: '2025-12-01T00:00:00Z',
    instrument: 'NIRCam',
  },
  metadata: {},
  processingResults: [],
};

describe('LineageFileCard', () => {
  let onFileSelect: ReturnType<typeof vi.fn<(dataId: string, event: React.MouseEvent) => void>>;
  let onView: ReturnType<typeof vi.fn<(item: JwstDataModel) => void>>;
  let onProcess: ReturnType<typeof vi.fn<(dataId: string, algorithm: string) => void>>;
  let onArchive: ReturnType<typeof vi.fn<(dataId: string, isArchived: boolean) => void>>;

  beforeEach(() => {
    onFileSelect = vi.fn<(dataId: string, event: React.MouseEvent) => void>();
    onView = vi.fn<(item: JwstDataModel) => void>();
    onProcess = vi.fn<(dataId: string, algorithm: string) => void>();
    onArchive = vi.fn<(dataId: string, isArchived: boolean) => void>();
  });

  const renderCard = (
    overrides: Partial<JwstDataModel> = {},
    props: Partial<{ isSelected: boolean; isArchiving: boolean }> = {}
  ) => {
    const item = { ...mockItem, ...overrides };
    return render(
      <LineageFileCard
        item={item}
        isSelected={false}
        isArchiving={false}
        onFileSelect={onFileSelect}
        onView={onView}
        onProcess={onProcess}
        onArchive={onArchive}
        {...props}
      />
    );
  };

  it('renders file name, data type, and file size', () => {
    renderCard();
    expect(screen.getByText('test_cal.fits')).toBeInTheDocument();
    expect(screen.getByText(/image/)).toBeInTheDocument();
    expect(screen.getByText(/5\.00 MB/)).toBeInTheDocument();
  });

  it('shows thumbnail for viewable files with hasThumbnail', () => {
    renderCard();
    const img = screen.getByAltText('test_cal.fits');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      'src',
      'http://test:5001/api/jwstdata/507f1f77bcf86cd799439011/thumbnail'
    );
  });

  it('shows telescope placeholder when no thumbnail', () => {
    renderCard({ hasThumbnail: false });
    expect(screen.getByTestId('telescope-icon')).toBeInTheDocument();
  });

  it('does not show thumbnail section for non-viewable files', () => {
    const { container } = renderCard({ fileName: 'test_cat.fits' });
    expect(container.querySelector('.lineage-thumbnail')).not.toBeInTheDocument();
  });

  it('view button shows "View" for images', () => {
    renderCard();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('view button shows "Table" for table files', () => {
    renderCard({ fileName: 'test_cat.fits' });
    expect(screen.getByText('Table')).toBeInTheDocument();
  });

  it('view button shows "Spectrum" for spectral files', () => {
    renderCard({ fileName: 'test_x1d.fits' });
    expect(screen.getByText('Spectrum')).toBeInTheDocument();
  });

  it('shows filter badge', () => {
    renderCard();
    expect(screen.getByText('F444W')).toBeInTheDocument();
  });

  it('shows processing status with color', () => {
    renderCard();
    const statusEl = screen.getByText('completed');
    expect(statusEl.style.color).toBe('green');
  });

  it('shows "Archive" button', () => {
    renderCard();
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('shows "Archiving..." when isArchiving', () => {
    renderCard({}, { isArchiving: true });
    expect(screen.getByText('Archiving...')).toBeInTheDocument();
  });

  it('shows "Unarchiving..." for archived items when isArchiving', () => {
    renderCard({ isArchived: true }, { isArchiving: true });
    expect(screen.getByText('Unarchiving...')).toBeInTheDocument();
  });

  it('archive button is disabled when isArchiving', () => {
    renderCard({}, { isArchiving: true });
    expect(screen.getByText('Archiving...')).toBeDisabled();
  });

  it('select button is present for viewable files', () => {
    const { container } = renderCard();
    expect(container.querySelector('.composite-select-btn')).toBeInTheDocument();
  });

  it('select button is absent for non-viewable files', () => {
    const { container } = renderCard({ fileName: 'test_cat.fits' });
    expect(container.querySelector('.composite-select-btn')).not.toBeInTheDocument();
  });

  it('shows CheckIcon when selected', () => {
    renderCard({}, { isSelected: true });
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('shows PlusIcon when not selected', () => {
    renderCard();
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
  });

  it('calls onView when view button clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('View'));
    expect(onView).toHaveBeenCalledWith(
      expect.objectContaining({ id: '507f1f77bcf86cd799439011' })
    );
  });

  it('calls onProcess when analyze button clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('Analyze'));
    expect(onProcess).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'basic_analysis');
  });

  it('calls onArchive when archive button clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('Archive'));
    expect(onArchive).toHaveBeenCalledWith('507f1f77bcf86cd799439011', false);
  });

  it('calls onFileSelect when select button clicked', () => {
    renderCard();
    const selectBtn = screen.getByTitle('Select for analysis');
    fireEvent.click(selectBtn);
    expect(onFileSelect).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.any(Object));
  });

  it('selected state adds selected-composite class', () => {
    const { container } = renderCard({}, { isSelected: true });
    expect(container.querySelector('.lineage-file-card.selected-composite')).toBeInTheDocument();
  });

  it('shows FITS type label', () => {
    renderCard();
    expect(screen.getByText('CAL')).toBeInTheDocument();
  });
});
