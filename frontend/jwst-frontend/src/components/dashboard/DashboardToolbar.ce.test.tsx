import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardToolbar from './DashboardToolbar';

// CE build: no uploads, no composite/mosaic wizards (auth'd async endpoints)
vi.mock('../../config/ce', () => ({ CE_MODE: true }));

describe('DashboardToolbar in CE mode', () => {
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

  it('hides Upload Data and the composite/mosaic wizard buttons', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: 'Upload Data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Composite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /WCS Mosaic/ })).not.toBeInTheDocument();
  });

  it('keeps the read-only affordances (MAST search link, Compare, view toggles)', () => {
    renderToolbar();
    expect(screen.getByRole('link', { name: 'Search MAST' })).toHaveAttribute('href', '/archive');
    expect(screen.getByRole('button', { name: /Compare/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lineage/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show Archived/ })).toBeInTheDocument();
  });
});
