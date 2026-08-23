import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FilterRail from './FilterRail';
import ActiveFilterChips from './ActiveFilterChips';
import { EMPTY_FACETS, describeFacets, type FacetState } from '../../utils/mastCriteria';

function renderRail(value: FacetState = EMPTY_FACETS, applied: FacetState = EMPTY_FACETS) {
  const onChange = vi.fn();
  const onApply = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <FilterRail
      value={value}
      onChange={onChange}
      onApply={onApply}
      onClear={onClear}
      applied={applied}
      loading={false}
      idLookup={false}
    />
  );
  return { ...utils, onChange, onApply, onClear };
}

const group = (name: string) => screen.getByRole('group', { name });

describe('FilterRail', () => {
  it('renders every instrument and toggles one into the draft', () => {
    const { onChange } = renderRail();
    const inst = group('Instrument');
    for (const label of ['NIRCam', 'NIRSpec', 'MIRI', 'NIRISS', 'FGS']) {
      expect(within(inst).getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    }
    fireEvent.click(within(inst).getByRole('button', { name: 'MIRI' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FACETS, instruments: ['MIRI'] });
  });

  it('shows the mode row only once an instrument is selected', () => {
    renderRail();
    expect(screen.queryByRole('group', { name: 'Mode' })).not.toBeInTheDocument();
    renderRail({ ...EMPTY_FACETS, instruments: ['NIRSPEC'] });
    const modes = group('Mode');
    for (const m of ['/IMAGE', '/IFU', '/MSA', '/SLIT']) {
      expect(within(modes).getByRole('button', { name: m })).toBeInTheDocument();
    }
  });

  it('offers filter presets for the selected instrument', () => {
    renderRail({ ...EMPTY_FACETS, instruments: ['MIRI'] });
    const filters = group('Filter');
    expect(within(filters).getByRole('button', { name: 'F770W' })).toBeInTheDocument();
    expect(within(filters).queryByRole('button', { name: 'F200W' })).not.toBeInTheDocument();
  });

  it('offers NIRCam presets for NIRCam and the union when nothing is selected', () => {
    const { unmount } = renderRail({ ...EMPTY_FACETS, instruments: ['NIRCAM'] });
    expect(within(group('Filter')).getByRole('button', { name: 'F200W' })).toBeInTheDocument();
    expect(
      within(group('Filter')).queryByRole('button', { name: 'F770W' })
    ).not.toBeInTheDocument();
    unmount();
    renderRail();
    expect(within(group('Filter')).getByRole('button', { name: 'F200W' })).toBeInTheDocument();
    expect(within(group('Filter')).getByRole('button', { name: 'F770W' })).toBeInTheDocument();
  });

  it('adds a free-text filter, uppercased, on Enter', () => {
    const { onChange } = renderRail();
    const input = screen.getByLabelText('Add a filter by name');
    fireEvent.change(input, { target: { value: 'f470n' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FACETS, filters: ['F470N'] });
  });

  it('rejects a filter name the whitelist would refuse', () => {
    const { onChange } = renderRail();
    const input = screen.getByLabelText('Add a filter by name');
    fireEvent.change(input, { target: { value: 'F200W;drop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/letters, digits/);
  });

  it('keeps at least one calibration level on', () => {
    const { onChange } = renderRail();
    const levels = group('Calibration level');
    fireEvent.click(within(levels).getByLabelText(/Level 3/));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(levels).getByLabelText(/Level 1/));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FACETS, calibLevels: [1, 3] });
  });

  it('Apply is disabled when the draft equals the applied facets, enabled otherwise', () => {
    const { onApply, unmount } = renderRail(EMPTY_FACETS, EMPTY_FACETS);
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    unmount();
    const changed = renderRail({ ...EMPTY_FACETS, dataproductTypes: ['cube'] }, EMPTY_FACETS);
    const apply = screen.getByRole('button', { name: 'Apply filters' });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(changed.onApply).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Clear all is disabled with nothing to clear and calls onClear otherwise', () => {
    const { onClear, unmount } = renderRail();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
    unmount();
    const r = renderRail({ ...EMPTY_FACETS, instruments: ['FGS'] });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(r.onClear).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('says filters do not apply to ID lookups', () => {
    render(
      <FilterRail
        value={EMPTY_FACETS}
        onChange={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
        applied={EMPTY_FACETS}
        loading={false}
        idLookup
      />
    );
    expect(screen.getByRole('note')).toHaveTextContent(/don't apply to ID lookups/);
  });

  it('sections collapse and expand', () => {
    renderRail();
    const toggle = screen.getByRole('button', { name: /^Instrument/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Instrument' })).not.toBeInTheDocument();
  });
});

describe('ActiveFilterChips', () => {
  it('renders each chip uppercase with a swatch and removes by key', () => {
    const onRemove = vi.fn();
    const chips = describeFacets(
      { ...EMPTY_FACETS, instruments: ['MIRI'], filters: ['F770W'] },
      { showWindow: true, defaultWindowApplied: true }
    );
    render(<ActiveFilterChips chips={chips} onRemove={onRemove} />);
    const list = screen.getByRole('list', { name: 'Active filters' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent?.replace('×', '').trim())).toEqual([
      'MIRI',
      'F770W',
      'LAST 90 DAYS',
    ]);
    expect(items[0]).toHaveAttribute('data-kind', 'miri');
    expect(items[0].querySelector('.facet-chip-swatch')).not.toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove filter F770W' }));
    expect(onRemove).toHaveBeenCalledWith('filt:F770W');
    fireEvent.click(within(list).getByRole('button', { name: 'Remove filter LAST 90 DAYS' }));
    expect(onRemove).toHaveBeenCalledWith('days');
  });

  it('renders nothing with no chips and no remove button for the widened window', () => {
    const { container, unmount } = render(<ActiveFilterChips chips={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    const chips = describeFacets(
      { ...EMPTY_FACETS, instruments: ['MIRI'], daysBack: 365 },
      { showWindow: true, defaultWindowApplied: false }
    );
    render(<ActiveFilterChips chips={chips} onRemove={vi.fn()} />);
    expect(screen.getByText('LAST 365 DAYS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /LAST 365 DAYS/ })).not.toBeInTheDocument();
  });
});
