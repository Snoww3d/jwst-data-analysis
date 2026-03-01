import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageFilterToolbar } from './ImageFilterToolbar';
import {
  ALL_FILTER_VALUE,
  type UseImageFiltersResult,
  type StageFilterValue,
} from '../../hooks/useImageFilters';

/** Build a mock UseImageFiltersResult for toolbar rendering tests. */
function makeFilters(overrides?: Partial<UseImageFiltersResult>): UseImageFiltersResult {
  return {
    searchTerm: '',
    setSearchTerm: vi.fn(),
    targetFilter: ALL_FILTER_VALUE,
    setTargetFilter: vi.fn(),
    stageFilter: ALL_FILTER_VALUE as StageFilterValue,
    setStageFilter: vi.fn(),
    wavelengthFilter: ALL_FILTER_VALUE,
    setWavelengthFilter: vi.fn(),
    targetOptions: ['Crab Nebula', 'Orion Nebula'],
    stageOptions: [
      { value: ALL_FILTER_VALUE as StageFilterValue, label: 'All Stages' },
      { value: 'L2b' as StageFilterValue, label: 'L2b (Calibrated)' },
    ],
    wavelengthOptions: ['F200W', 'F770W'],
    filteredImages: [],
    isFiltered: false,
    totalCount: 5,
    filteredCount: 5,
    ...overrides,
  };
}

describe('ImageFilterToolbar', () => {
  it('renders search input and filter dropdowns', () => {
    render(<ImageFilterToolbar filters={makeFilters()} />);
    expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Target')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter')).toBeInTheDocument();
  });

  it('does not show count when not filtered', () => {
    render(<ImageFilterToolbar filters={makeFilters({ isFiltered: false })} />);
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  it('shows "N of M" count when filtered', () => {
    render(
      <ImageFilterToolbar
        filters={makeFilters({ isFiltered: true, filteredCount: 3, totalCount: 5 })}
      />
    );
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
  });

  it('renders target options in dropdown', () => {
    render(<ImageFilterToolbar filters={makeFilters()} />);
    const select = screen.getByLabelText('Target') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.text);
    expect(options).toContain('All Targets');
    expect(options).toContain('Crab Nebula');
    expect(options).toContain('Orion Nebula');
  });

  it('calls setSearchTerm on input', () => {
    const setSearchTerm = vi.fn();
    render(<ImageFilterToolbar filters={makeFilters({ setSearchTerm })} />);
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: 'crab' },
    });
    expect(setSearchTerm).toHaveBeenCalledWith('crab');
  });

  it('calls setTargetFilter on dropdown change', () => {
    const setTargetFilter = vi.fn();
    render(<ImageFilterToolbar filters={makeFilters({ setTargetFilter })} />);
    fireEvent.change(screen.getByLabelText('Target'), {
      target: { value: 'Crab Nebula' },
    });
    expect(setTargetFilter).toHaveBeenCalledWith('Crab Nebula');
  });

  it('applies compact variant class by default', () => {
    const { container } = render(<ImageFilterToolbar filters={makeFilters()} />);
    expect(container.querySelector('.image-filter-toolbar.compact')).toBeInTheDocument();
  });

  it('applies wide variant class when specified', () => {
    const { container } = render(<ImageFilterToolbar filters={makeFilters()} variant="wide" />);
    expect(container.querySelector('.image-filter-toolbar.wide')).toBeInTheDocument();
  });
});
