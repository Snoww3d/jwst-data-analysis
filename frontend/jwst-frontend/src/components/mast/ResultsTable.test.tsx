import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
