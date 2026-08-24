import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultsToolbar from './ResultsToolbar';
import type { AvailabilityStatus } from './hooks/useLibraryAvailability';
import { COLUMNS_STORAGE_KEY, loadVisibleColumns, saveVisibleColumns } from './resultColumns';

describe('ResultsToolbar', () => {
  const baseProps = {
    count: 2,
    truncated: false,
    pageSize: 500,
    visibleColumns: new Set<string>(),
    onVisibleColumnsChange: vi.fn(),
    selectedCount: 0,
    onBulkImport: vi.fn(),
    importing: false,
    isAuthenticated: true,
    availabilityStatus: 'ready' as AvailabilityStatus,
    downloadSource: 'auto' as const,
    onDownloadSourceChange: vi.fn(),
    view: 'table' as const,
    onViewChange: vi.fn(),
    onFitMap: vi.fn(),
  };

  const renderToolbar = (props: Partial<typeof baseProps> = {}) =>
    render(<ResultsToolbar {...baseProps} {...props} />);

  beforeEach(() => localStorage.clear());

  it('shows the result count', () => {
    renderToolbar();
    expect(screen.getByText('Search Results (2)')).toBeInTheDocument();
  });

  // #1648: /archive became public in #1619, but only the per-row action grew an
  // auth gate. Anonymous users could still select rows and fire a bulk import,
  // which 401s every job and shows a wall of failures instead of a login hint.
  it('hides the bulk-import button from anonymous users', () => {
    renderToolbar({ isAuthenticated: false, selectedCount: 1 });
    expect(screen.queryByText(/Import Selected/)).not.toBeInTheDocument();
  });

  it('shows the bulk-import button once authenticated and reports clicks', () => {
    const onBulkImport = vi.fn();
    renderToolbar({ isAuthenticated: true, selectedCount: 1, onBulkImport });
    fireEvent.click(screen.getByText('Import Selected (1)'));
    expect(onBulkImport).toHaveBeenCalled();
  });

  it('disables bulk import while an import is running', () => {
    renderToolbar({ selectedCount: 2, importing: true });
    expect(screen.getByText('Import Selected (2)')).toBeDisabled();
  });

  describe('truncation banner', () => {
    it('is absent when the server returned everything', () => {
      renderToolbar({ truncated: false });
      expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
    });

    it('names the cap when the server truncated', () => {
      renderToolbar({ truncated: true, pageSize: 500, count: 500 });
      expect(screen.getByText(/Showing the first 500 observations/)).toBeInTheDocument();
    });
  });

  it('says so when the library status could not be fetched', () => {
    renderToolbar({ availabilityStatus: 'unavailable' });
    expect(screen.getByText(/Library status unavailable/)).toBeInTheDocument();
  });

  describe('column picker', () => {
    it('lists only the optional columns and reports toggles', () => {
      const onVisibleColumnsChange = vi.fn();
      renderToolbar({ onVisibleColumnsChange });
      fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
      const dialog = screen.getByRole('dialog', { name: 'Choose columns' });
      expect(dialog).toHaveTextContent('PI');
      expect(dialog).not.toHaveTextContent('Obs ID');
      fireEvent.click(screen.getByLabelText(/^PI/));
      expect(onVisibleColumnsChange).toHaveBeenCalledWith(new Set(['proposal_pi']));
    });

    it('persists the picked columns and reads them back', () => {
      saveVisibleColumns(new Set(['proposal_pi', 's_ra', 'not_a_column']));
      expect(JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? '[]')).toEqual([
        's_ra',
        'proposal_pi',
      ]);
      expect(loadVisibleColumns()).toEqual(new Set(['s_ra', 'proposal_pi']));
    });

    it('ignores corrupt storage', () => {
      localStorage.setItem(COLUMNS_STORAGE_KEY, '{not json');
      expect(loadVisibleColumns()).toEqual(new Set());
      localStorage.setItem(COLUMNS_STORAGE_KEY, '["bogus"]');
      expect(loadVisibleColumns()).toEqual(new Set());
    });
  });

  describe('import options (download source, relocated from the table header)', () => {
    it('shows the selector to authenticated users behind the popover and reports changes', () => {
      const onDownloadSourceChange = vi.fn();
      renderToolbar({ onDownloadSourceChange });
      fireEvent.click(screen.getByRole('button', { name: /Import options/ }));
      const select = screen.getByRole('combobox', { name: /download source/i });
      fireEvent.change(select, { target: { value: 's3' } });
      expect(onDownloadSourceChange).toHaveBeenCalledWith('s3');
    });

    it('hides the popover from anonymous users (they cannot import)', () => {
      renderToolbar({ isAuthenticated: false });
      expect(screen.queryByRole('button', { name: /Import options/ })).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
      renderToolbar();
      fireEvent.click(screen.getByRole('button', { name: /Import options/ }));
      expect(screen.getByRole('dialog', { name: 'Import options' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Import options' })).not.toBeInTheDocument();
    });
  });

  it('view toggle: Table active by default; Split switches (MAST Search v2 Phase 5)', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    const split = screen.getByRole('button', { name: 'Split' });
    expect(split).toBeEnabled();
    fireEvent.click(split);
    expect(baseProps.onViewChange).toHaveBeenCalledWith('split');
  });

  it('split view shows "Fit map to results"; table view does not', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: 'Fit map to results' })).toBeNull();
    renderToolbar({ view: 'split' as never });
    fireEvent.click(screen.getByRole('button', { name: 'Fit map to results' }));
    expect(baseProps.onFitMap).toHaveBeenCalled();
  });

  describe('drawn region (draw-to-search, Phase 6)', () => {
    const region = { kind: 'circle' as const, ra: 100, dec: -30, r: 0.5 };

    it('shows the removable region chip and the unclippable note', () => {
      const onRegionClear = vi.fn();
      renderToolbar({ region, unclippable: 3, onRegionClear } as never);
      expect(screen.getByText('REGION: CIRCLE · R 0.50°')).toBeInTheDocument();
      expect(screen.getByText('3 without a readable footprint kept.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Remove the drawn region' }));
      expect(onRegionClear).toHaveBeenCalled();
    });

    it('no chip and no note without a region', () => {
      renderToolbar({ unclippable: 3 } as never);
      expect(screen.queryByText(/REGION:/)).toBeNull();
      expect(screen.queryByText(/without a readable footprint/)).toBeNull();
    });

    it('the truncation banner speaks region during a region search', () => {
      renderToolbar({ region, truncated: true, pageSize: 500 } as never);
      expect(screen.getByText(/region query hit the 500 cap/)).toBeInTheDocument();
      expect(screen.queryByText(/Narrow the radius/)).toBeNull();
    });
  });
});
