import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TargetGroupView from './TargetGroupView';
import type { JwstDataModel } from '../../types/JwstDataTypes';

vi.mock('./DataCard', () => ({
  default: (props: { item: { id: string } }) => <div data-testid={`data-card-${props.item.id}`} />,
}));

describe('TargetGroupView', () => {
  const defaultProps = {
    filteredData: [],
    collapsedGroups: new Set<string>(),
    selectedFiles: new Set<string>(),
    selectedTag: 'all',
    archivingIds: new Set<string>(),
    onToggleGroup: vi.fn(),
    onFileSelect: vi.fn(),
    onView: vi.fn(),
    onArchive: vi.fn(),
    onTagClick: vi.fn(),
  };

  it('renders empty state when no data', () => {
    render(<TargetGroupView {...defaultProps} />);
    expect(screen.getByText('No data found')).toBeInTheDocument();
  });

  it('renders target group when data is provided', () => {
    const mockData: JwstDataModel[] = [
      {
        id: '1',
        fileName: 'test.fits',
        fileSize: 1024,
        uploadDate: '2024-01-01T00:00:00Z',
        dataType: 'image',
        hasThumbnail: false,
        isArchived: false,
        tags: [],
        metadata: {},
        processingStatus: 'completed',
        processingResults: [],
        imageInfo: { targetName: 'NGC 1234' },
      } as unknown as JwstDataModel,
    ];

    render(<TargetGroupView {...defaultProps} filteredData={mockData} />);
    expect(screen.getByText('NGC 1234')).toBeInTheDocument();
    expect(screen.getByText('1 file')).toBeInTheDocument();
  });
});
