import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LineageView from './LineageView';
import type { JwstDataModel } from '../../types/JwstDataTypes';

// CE: no delete-observation / archive-level / delete-level controls
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('./LineageFileCard', () => ({
  default: (props: { item: { id: string } }) => (
    <div data-testid={`lineage-file-card-${props.item.id}`} />
  ),
}));

const item: JwstDataModel = {
  id: '1',
  fileName: 'test_i2d.fits',
  fileSize: 1024,
  uploadDate: '2024-01-01T00:00:00Z',
  processingLevel: 'L3',
  observationBaseId: 'jw01234-o001',
  dataType: 'image',
  processingStatus: 'completed',
  filePath: 'mast/x/test_i2d.fits',
  tags: [],
  description: '',
  isArchived: false,
  hasThumbnail: false,
  metadata: {},
  processingResults: [],
};

describe('LineageView in CE mode', () => {
  const props = {
    filteredData: [item],
    collapsedLineages: new Set<string>(),
    expandedLevels: new Set<string>(['jw01234-o001-L3']),
    selectedFiles: new Set<string>(),
    archivingIds: new Set<string>(),
    onToggleLineage: vi.fn(),
    onToggleLevel: vi.fn(),
    onDeleteObservation: vi.fn(),
    onDeleteLevel: vi.fn(),
    onArchiveLevel: vi.fn(),
    isArchivingLevel: false,
    onFileSelect: vi.fn(),
    onView: vi.fn(),
    onArchive: vi.fn(),
    hasActiveFilters: false,
    totalCount: 1,
    onClearFilters: vi.fn(),
  };

  it('hides observation delete and level archive/delete controls', () => {
    render(<LineageView {...props} />);
    expect(screen.getByTestId('lineage-file-card-1')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete this observation')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Archive all/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Delete all/)).not.toBeInTheDocument();
  });

  it('empty state does not advertise uploads', () => {
    render(<LineageView {...props} filteredData={[]} totalCount={0} />);
    expect(screen.getByText('Search MAST to get started.')).toBeInTheDocument();
  });
});
