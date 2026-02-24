import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardToolbar from './DashboardToolbar';

describe('DashboardToolbar', () => {
  const defaultProps = {
    searchTerm: '',
    selectedDataType: 'all',
    selectedProcessingLevel: 'all',
    selectedViewability: 'all',
    selectedTag: 'all',
    onSearchChange: vi.fn(),
    onDataTypeChange: vi.fn(),
    onProcessingLevelChange: vi.fn(),
    onViewabilityChange: vi.fn(),
    onTagChange: vi.fn(),
    baseFilteredCount: 10,
    afterTypeFilterCount: 10,
    afterLevelFilterCount: 10,
    availableTypes: {
      dataTypeCounts: new Map<string, number>(),
      viewableCount: 5,
      tableCount: 2,
    },
    availableLevels: new Map<string, number>(),
    availableTags: [],
    viewMode: 'lineage' as const,
    onViewModeChange: vi.fn(),
    showArchived: false,
    onToggleArchived: vi.fn(),
    onShowUpload: vi.fn(),
    showMastSearch: false,
    onToggleMastSearch: vi.fn(),
    showWhatsNew: false,
    onToggleWhatsNew: vi.fn(),
    selectedCount: 0,
    onOpenCompositeWizard: vi.fn(),
    onOpenMosaicWizard: vi.fn(),
    onOpenComparisonPicker: vi.fn(),
  };

  it('renders the search input', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(
      screen.getByPlaceholderText('Search files, descriptions, or tags...')
    ).toBeInTheDocument();
  });

  it('renders Upload Data button', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByText('Upload Data')).toBeInTheDocument();
  });

  it('renders Search MAST button', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByText('Search MAST')).toBeInTheDocument();
  });

  it('renders view mode toggle buttons', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByText('Lineage')).toBeInTheDocument();
    expect(screen.getByText('By Target')).toBeInTheDocument();
  });

  it('renders analysis action buttons', () => {
    render(<DashboardToolbar {...defaultProps} />);
    expect(screen.getByText(/Composite/)).toBeInTheDocument();
    expect(screen.getByText(/WCS Mosaic/)).toBeInTheDocument();
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });
});
