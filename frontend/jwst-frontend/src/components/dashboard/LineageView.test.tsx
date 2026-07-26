import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LineageView from './LineageView';
import type { JwstDataModel } from '../../types/JwstDataTypes';

vi.mock('./LineageFileCard', () => ({
  default: (props: { item: { id: string }; onReprocess?: unknown }) => (
    <div
      data-testid={`lineage-file-card-${props.item.id}`}
      data-has-reprocess={props.onReprocess ? 'yes' : 'no'}
    />
  ),
}));

describe('LineageView', () => {
  const defaultProps = {
    filteredData: [],
    collapsedLineages: new Set<string>(),
    expandedLevels: new Set<string>(),
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
    totalCount: 0,
    onClearFilters: vi.fn(),
  };

  it('renders empty state when no data', () => {
    render(<LineageView {...defaultProps} />);
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    expect(
      screen.getByText('Upload FITS files or search MAST to get started.')
    ).toBeInTheDocument();
  });

  it('renders observation groups when data is provided', () => {
    const mockData: JwstDataModel[] = [
      {
        id: '1',
        fileName: 'test.fits',
        fileSize: 1024,
        uploadDate: '2024-01-01T00:00:00Z',
        processingLevel: 'L2b',
        observationBaseId: 'jw01234-o001',
        dataType: 'image',
        hasThumbnail: false,
        isArchived: false,
        tags: [],
        metadata: {},
        processingStatus: 'completed',
        processingResults: [],
      } as JwstDataModel,
    ];

    render(<LineageView {...defaultProps} filteredData={mockData} />);
    expect(screen.getByText('jw01234-o001')).toBeInTheDocument();
  });

  const oneFile: JwstDataModel[] = [
    {
      id: '1',
      fileName: 'jw01234_cal.fits',
      fileSize: 1024,
      uploadDate: '2024-01-01T00:00:00Z',
      processingLevel: 'L2b',
      observationBaseId: 'jw01234-o001',
      dataType: 'image',
      hasThumbnail: false,
      isArchived: false,
      tags: [],
      metadata: {},
      processingStatus: 'completed',
      processingResults: [],
    } as JwstDataModel,
  ];

  it('passes onReprocess down to each file card', () => {
    const onReprocess = vi.fn();
    render(
      <LineageView
        {...defaultProps}
        filteredData={oneFile}
        expandedLevels={new Set(['jw01234-o001-L2b'])}
        onReprocess={onReprocess}
      />
    );
    expect(screen.getByTestId('lineage-file-card-1')).toHaveAttribute('data-has-reprocess', 'yes');
  });

  it('leaves onReprocess undefined when calibration is unavailable', () => {
    render(
      <LineageView
        {...defaultProps}
        filteredData={oneFile}
        expandedLevels={new Set(['jw01234-o001-L2b'])}
      />
    );
    expect(screen.getByTestId('lineage-file-card-1')).toHaveAttribute('data-has-reprocess', 'no');
  });
});
