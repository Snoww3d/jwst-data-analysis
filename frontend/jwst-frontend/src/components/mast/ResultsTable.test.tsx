import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResultsTable from './ResultsTable';
import type { MastObservationResult } from '../../types/MastTypes';
import type { DataAvailabilityItem } from '../../types/JwstDataTypes';

const makeResult = (obsId: string): MastObservationResult => ({
  obs_id: obsId,
  target_name: 'Carina Nebula',
  instrument_name: 'NIRCAM/IMAGE',
  filters: 'F090W',
  t_exptime: 120,
});

describe('ResultsTable', () => {
  const baseProps = {
    searchResults: [makeResult('jw001'), makeResult('jw002')],
    paginatedResults: [makeResult('jw001'), makeResult('jw002')],
    startIndex: 0,
    endIndex: 2,
    selectedObs: new Set<string>(),
    onToggleSelection: vi.fn(),
    onBulkImport: vi.fn(),
    importing: null,
    onImport: vi.fn(),
    isAuthenticated: true,
    downloadSource: 'auto' as const,
    onDownloadSourceChange: vi.fn(),
    availability: {} as Record<string, DataAvailabilityItem>,
    currentPage: 1,
    totalPages: 1,
    itemsPerPage: 10,
    onPageChange: vi.fn(),
    onItemsPerPageChange: vi.fn(),
  };

  const renderTable = (props: Partial<typeof baseProps> = {}) =>
    render(
      <MemoryRouter>
        <ResultsTable {...baseProps} {...props} />
      </MemoryRouter>
    );

  it('renders one row per result with an Import button when authenticated', () => {
    renderTable();
    expect(screen.getByText('Search Results (2)')).toBeInTheDocument();
    expect(screen.getAllByText('Import')).toHaveLength(2);
  });

  it('shows an "In Library" badge for observations already available', () => {
    renderTable({
      availability: {
        jw001: { available: true, dataIds: ['abc'], filter: 'F090W' },
      },
    });
    expect(screen.getByText('In Library')).toBeInTheDocument();
    // The other, unavailable result still shows the normal Import button
    expect(screen.getAllByText('Import')).toHaveLength(1);
  });

  it('shows "Log in to import" instead of the Import button when anonymous', () => {
    renderTable({ isAuthenticated: false });
    const loginLinks = screen.getAllByText('Log in to import');
    expect(loginLinks).toHaveLength(2);
    expect(loginLinks[0].closest('a')).toHaveAttribute('href', '/login');
  });

  it('prefers the "In Library" badge over the anonymous login gate', () => {
    renderTable({
      isAuthenticated: false,
      availability: {
        jw001: { available: true, dataIds: ['abc'] },
      },
    });
    expect(screen.getByText('In Library')).toBeInTheDocument();
    expect(screen.getAllByText('Log in to import')).toHaveLength(1);
  });

  // #1648: /archive became public in #1619, but only the per-row action grew an
  // auth gate. Anonymous users could still select rows and fire a bulk import,
  // which 401s every job and shows a wall of failures instead of a login hint.
  it('hides the bulk-import button from anonymous users', () => {
    renderTable({ isAuthenticated: false, selectedObs: new Set(['jw001']) });

    expect(screen.queryByText(/Import Selected/)).not.toBeInTheDocument();
  });

  it('shows the bulk-import button once authenticated', () => {
    renderTable({ isAuthenticated: true, selectedObs: new Set(['jw001']) });

    expect(screen.getByText('Import Selected (1)')).toBeInTheDocument();
  });

  it('disables the selection checkboxes for anonymous users', () => {
    renderTable({ isAuthenticated: false });

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    boxes.forEach((box) => expect(box).toBeDisabled());
  });

  it('leaves the selection checkboxes usable when authenticated', () => {
    renderTable({ isAuthenticated: true });

    screen.getAllByRole('checkbox').forEach((box) => expect(box).toBeEnabled());
  });

  describe('download source (relocated from the search form, Phase 2)', () => {
    it('shows the selector to authenticated users and reports changes', () => {
      const onDownloadSourceChange = vi.fn();
      renderTable({ onDownloadSourceChange });
      const select = screen.getByRole('combobox', { name: /download source/i });
      fireEvent.change(select, { target: { value: 's3' } });
      expect(onDownloadSourceChange).toHaveBeenCalledWith('s3');
    });

    it('hides the selector from anonymous users (they cannot import)', () => {
      renderTable({ isAuthenticated: false });
      expect(screen.queryByRole('combobox', { name: /download source/i })).not.toBeInTheDocument();
    });
  });
});
