import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { JwstDataModel } from '../../types/JwstDataTypes';
import DataCard from './DataCard';

// CE build: library is a public read-only view — no mutations, no selection
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));
vi.mock('../../utils/fitsUtils', () => ({
  getFitsFileInfo: () => ({
    type: 'image',
    label: 'CAL',
    viewable: true,
    description: 'Calibrated image',
  }),
  isSpectralFile: () => false,
}));
vi.mock('../../utils/statusUtils', () => ({ getStatusColor: () => 'green' }));

const item: JwstDataModel = {
  id: '507f1f77bcf86cd799439011',
  fileName: 'test_cal.fits',
  dataType: 'image',
  fileSize: 5242880,
  processingStatus: 'completed',
  filePath: '/app/data/mast/test/test_cal.fits',
  uploadDate: '2026-01-01T00:00:00Z',
  tags: [],
  description: '',
  isArchived: false,
  hasThumbnail: false,
  metadata: {},
  processingResults: [],
};

describe('DataCard in CE mode', () => {
  it('renders View but no Archive and no composite-select', () => {
    render(
      <DataCard
        item={item}
        isSelected={false}
        isArchiving={false}
        selectedTag=""
        onFileSelect={vi.fn()}
        onView={vi.fn()}
        onArchive={vi.fn()}
        onTagClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
    expect(document.querySelector('.composite-select-btn')).toBeNull();
  });
});
