import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SmartSearchInput from './SmartSearchInput';
import type { RecentSearch } from '../../utils/recentSearches';

describe('SmartSearchInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const baseProps = {
    value: '',
    onChange: vi.fn(),
    radius: '0.2',
    onRadiusChange: vi.fn(),
    showAllCalibLevels: false,
    onShowAllCalibLevelsChange: vi.fn(),
    loading: false,
    recents: [] as RecentSearch[],
    onSubmit: vi.fn(),
  };

  const renderInput = (props: Partial<typeof baseProps> = {}) =>
    render(<SmartSearchInput {...baseProps} {...props} />);

  const settle = () => act(() => vi.advanceTimersByTime(200));

  it('shows a prompt before anything is typed and wires the hint via aria-describedby', () => {
    renderInput();
    const input = screen.getByRole('textbox', { name: 'Search MAST' });
    const hint = screen.getByText(/Type a target name/);
    expect(hint.id).toBe(input.getAttribute('aria-describedby'));
    expect(hint).toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    ['M16', 'Interpreted as: target name "M16"', true],
    ['10h 37m -58°', 'Interpreted as: coordinates 159.25°, −58.00°', true],
    ['PID 2739', 'Interpreted as: program 2739', false],
    ['jw02739-o001', 'Interpreted as: observation ID jw02739-o001', false],
  ])('%s → hint "%s" (radius shown: %s)', (value, hint, radiusShown) => {
    renderInput({ value });
    settle();
    expect(screen.getByText(hint)).toBeInTheDocument();
    const radius = screen.queryByRole('spinbutton', { name: /Search radius/ });
    if (radiusShown) expect(radius).toBeInTheDocument();
    else expect(radius).not.toBeInTheDocument();
  });

  it('hides the calibration toggle for observation IDs (they always return every level)', () => {
    renderInput({ value: 'jw02739-o001' });
    settle();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('debounces the hint', () => {
    const { rerender } = renderInput({ value: 'M1' });
    settle();
    rerender(<SmartSearchInput {...baseProps} value="M16" />);
    expect(screen.getByText('Interpreted as: target name "M1"')).toBeInTheDocument();
    settle();
    expect(screen.getByText('Interpreted as: target name "M16"')).toBeInTheDocument();
  });

  it('submits the query and radius on Enter and on the button', () => {
    const onSubmit = vi.fn();
    renderInput({ value: 'M16', radius: '0.5', onSubmit });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search MAST' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Search MAST' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith('M16', '0.5');
  });

  it('renders recent searches as chips that fill the input and submit', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const onRadiusChange = vi.fn();
    renderInput({
      onSubmit,
      onChange,
      onRadiusChange,
      recents: [
        { q: 'NGC 3324', r: '0.5', at: 2 },
        { q: 'M16', r: '0.2', at: 1 },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'NGC 3324' }));
    expect(onChange).toHaveBeenCalledWith('NGC 3324');
    expect(onRadiusChange).toHaveBeenCalledWith('0.5');
    expect(onSubmit).toHaveBeenCalledWith('NGC 3324', '0.5');
  });

  it('disables the search button while loading', () => {
    renderInput({ loading: true });
    expect(screen.getByRole('button', { name: /Searching MAST/ })).toBeDisabled();
  });
});
