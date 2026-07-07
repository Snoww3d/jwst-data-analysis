import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { JwstDataModel } from '../../types/JwstDataTypes';
import LineageFileCard from './LineageFileCard';

// CE: read-only file rows — no archive, no composite selection
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));
vi.mock('../../utils/fitsUtils', () => ({
  getFitsFileInfo: () => ({
    type: 'image',
    label: 'I2D',
    viewable: true,
    description: 'Resampled image',
  }),
  isSpectralFile: () => false,
}));
vi.mock('../../utils/statusUtils', () => ({ getStatusColor: () => 'green' }));

const item: JwstDataModel = {
  id: 'abc123',
  fileName: 'test_i2d.fits',
  dataType: 'image',
  fileSize: 1048576,
  processingStatus: 'completed',
  filePath: 'mast/x/test_i2d.fits',
  uploadDate: '2026-01-01T00:00:00Z',
  tags: [],
  description: '',
  isArchived: false,
  hasThumbnail: false,
  metadata: {},
  processingResults: [],
};

describe('LineageFileCard in CE mode', () => {
  it('renders View but hides Archive and composite-select', () => {
    render(
      <LineageFileCard
        item={item}
        isSelected={false}
        isArchiving={false}
        onFileSelect={vi.fn()}
        onView={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
    expect(document.querySelector('.composite-select-btn')).toBeNull();
  });
});
