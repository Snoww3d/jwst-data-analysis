import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardToolbar from './DashboardToolbar';

describe('DashboardToolbar', () => {
  const defaultProps = {
    searchTerm: '',
    selectedDataType: 'all',
    selectedProcessingLevel: 'all',
    selectedViewability: 'all',
    selectedInstrument: 'all',
    selectedTag: 'all',
    onSearchChange: vi.fn(),
    onDataTypeChange: vi.fn(),
    onProcessingLevelChange: vi.fn(),
    onViewabilityChange: vi.fn(),
    onInstrumentChange: vi.fn(),
    onTagChange: vi.fn(),
    baseFilteredCount: 10,
    afterTypeFilterCount: 10,
    afterLevelFilterCount: 10,
    afterInstrumentFilterCount: 10,
    availableTypes: {
      dataTypeCounts: new Map<string, number>(),
      viewableCount: 5,
      tableCount: 2,
    },
    availableLevels: new Map<string, number>(),
    availableInstruments: {
      groupCounts: new Map<string, number>(),
      modeCounts: new Map<string, number>(),
    },
    availableTags: [],
    viewMode: 'lineage' as const,
    onViewModeChange: vi.fn(),
    showArchived: false,
    onToggleArchived: vi.fn(),
    onShowUpload: vi.fn(),
    selectedCount: 0,
    onOpenCompositeWizard: vi.fn(),
    onOpenMosaicWizard: vi.fn(),
    onOpenComparisonPicker: vi.fn(),
  };

  const renderToolbar = () =>
    render(
      <MemoryRouter>
        <DashboardToolbar {...defaultProps} />
      </MemoryRouter>
    );

  it('renders the search input', () => {
    renderToolbar();
    expect(
      screen.getByPlaceholderText('Search files, descriptions, or tags...')
    ).toBeInTheDocument();
  });

  it('renders Upload Data button', () => {
    renderToolbar();
    expect(screen.getByText('Upload Data')).toBeInTheDocument();
  });

  it('renders a Search MAST link to /archive', () => {
    renderToolbar();
    const link = screen.getByText('Search MAST').closest('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/archive');
  });

  it('renders view mode toggle with label', () => {
    renderToolbar();
    expect(screen.getByText('View:')).toBeInTheDocument();
    expect(screen.getByText('Lineage')).toBeInTheDocument();
    expect(screen.getByText('By Target')).toBeInTheDocument();
  });

  it('renders analysis action buttons', () => {
    renderToolbar();
    expect(screen.getByText(/Composite/)).toBeInTheDocument();
    expect(screen.getByText(/WCS Mosaic/)).toBeInTheDocument();
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });
});
