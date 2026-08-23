import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResultsTable from './ResultsTable';
import type { MastObservationResult } from '../../types/MastTypes';
import type { DataAvailabilityItem } from '../../types/JwstDataTypes';
import { DEFAULT_SORT } from './resultSort';

const makeResult = (
  obsId: string,
  extra: Partial<MastObservationResult> = {}
): MastObservationResult => ({
  obs_id: obsId,
  target_name: 'Carina Nebula',
  instrument_name: 'NIRCAM/IMAGE',
  filters: 'F090W',
  t_exptime: 120,
  ...extra,
});

describe('ResultsTable', () => {
  const baseProps = {
    rows: [makeResult('jw001'), makeResult('jw002')],
    sort: DEFAULT_SORT,
    onSortChange: vi.fn(),
    visibleColumns: new Set<string>(),
    selectedObs: new Set<string>(),
    onToggleSelection: vi.fn(),
    importing: null,
    onImport: vi.fn(),
    isAuthenticated: true,
    availability: {} as Record<string, DataAvailabilityItem>,
  };

  const renderTable = (props: Partial<typeof baseProps> = {}) =>
    render(
      <MemoryRouter>
        <ResultsTable {...baseProps} {...props} />
      </MemoryRouter>
    );

  it('renders one row per result with an Import button when authenticated', () => {
    renderTable();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
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

  it('reports selection toggles to the page (selection is lifted)', () => {
    const onToggleSelection = vi.fn();
    renderTable({ onToggleSelection });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select jw001' }));
    expect(onToggleSelection).toHaveBeenCalledWith('jw001');
  });

  describe('sorting (MAST Search v2 Phase 3)', () => {
    it('marks the active column with aria-sort and the others none', () => {
      renderTable({ sort: { key: 't_exptime', dir: 'asc' } });
      expect(screen.getByRole('columnheader', { name: /Exp Time/ })).toHaveAttribute(
        'aria-sort',
        'ascending'
      );
      expect(screen.getByRole('columnheader', { name: /Obs ID/ })).toHaveAttribute(
        'aria-sort',
        'none'
      );
    });

    it('clicking a header asks for ascending on a new column, then flips', () => {
      const onSortChange = vi.fn();
      renderTable({ onSortChange, sort: { key: 't_exptime', dir: 'asc' } });
      fireEvent.click(screen.getByRole('button', { name: /^Obs ID$/ }));
      expect(onSortChange).toHaveBeenLastCalledWith({ key: 'obs_id', dir: 'asc' });
      fireEvent.click(screen.getByRole('button', { name: /^Exp Time$/ }));
      expect(onSortChange).toHaveBeenLastCalledWith({ key: 't_exptime', dir: 'desc' });
    });

    it('orders rows by the given sort', () => {
      renderTable({
        rows: [makeResult('a', { t_exptime: 5 }), makeResult('b', { t_exptime: 50 })],
        sort: { key: 't_exptime', dir: 'desc' },
      });
      const ids = screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.getAttribute('data-obs-id'));
      expect(ids).toEqual(['b', 'a']);
    });
  });

  it('gives each row an id and data-obs-id for map linkage', () => {
    renderTable();
    const row = document.getElementById('obs-jw001');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-obs-id', 'jw001');
  });

  it('shows optional columns only when picked', () => {
    renderTable({ rows: [makeResult('jw001', { proposal_pi: 'Pontoppidan' })] });
    expect(screen.queryByRole('columnheader', { name: /PI/ })).not.toBeInTheDocument();
    renderTable({
      rows: [makeResult('jw001', { proposal_pi: 'Pontoppidan' })],
      visibleColumns: new Set(['proposal_pi']),
    });
    expect(screen.getByRole('columnheader', { name: /PI/ })).toBeInTheDocument();
    expect(screen.getByText('Pontoppidan')).toBeInTheDocument();
  });

  it('pages client-side and says how many rows are loaded', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      makeResult(`jw${String(i).padStart(3, '0')}`)
    );
    renderTable({ rows });
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText(/Page 1 of 3 · 25 loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Next page'));
    expect(screen.getByText(/Page 2 of 3 · 25 loaded/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
  });
});
