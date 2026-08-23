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

  it('reserves the view toggle: Table active, Split disabled until the sky map lands', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled();
  });
});
