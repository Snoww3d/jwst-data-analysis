import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StretchControls, { StretchParams } from './StretchControls';

const defaultParams: StretchParams = {
  stretch: 'zscale',
  gamma: 1.0,
  blackPoint: 0.0,
  whitePoint: 1.0,
  asinhA: 0.1,
  curve: 'linear',
};

describe('StretchControls', () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  const renderControls = (overrides: Partial<StretchParams> = {}, collapsed = false) => {
    const params = { ...defaultParams, ...overrides };
    return render(
      <StretchControls params={params} onChange={onChange as any} collapsed={collapsed} />
    );
  };

  it('renders the algorithm select with all options', () => {
    renderControls();
    const select = screen.getByDisplayValue('ZScale');
    expect(select).toBeInTheDocument();
    expect(select.tagName).toBe('SELECT');

    // Check all options are present
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(7);
    expect(screen.getByText('ZScale')).toBeInTheDocument();
    expect(screen.getByText('Asinh')).toBeInTheDocument();
    expect(screen.getByText('Logarithmic')).toBeInTheDocument();
    expect(screen.getByText('Square Root')).toBeInTheDocument();
    expect(screen.getByText('Power Law')).toBeInTheDocument();
    expect(screen.getByText('Histogram Eq.')).toBeInTheDocument();
    // "Linear" appears in both stretch and tone curve selects
    expect(screen.getAllByText('Linear').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onChange when algorithm changes', () => {
    renderControls();
    const select = screen.getByDisplayValue('ZScale');
    fireEvent.change(select, { target: { value: 'log' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stretch: 'log' }));
  });

  it('shows black point display with percentage', () => {
    renderControls({ blackPoint: 0.15 });
    expect(screen.getByText('15.0%')).toBeInTheDocument();
  });

  it('shows white point display with percentage', () => {
    renderControls({ whitePoint: 0.85 });
    expect(screen.getByText('85.0%')).toBeInTheDocument();
  });

  it('shows gamma value', () => {
    renderControls({ gamma: 2.5 });
    expect(screen.getByText('2.50')).toBeInTheDocument();
  });

  it('shows asinh softening slider only for asinh stretch', () => {
    const { rerender } = render(
      <StretchControls params={defaultParams} onChange={onChange as any} />
    );
    expect(screen.queryByText('Asinh Softening')).not.toBeInTheDocument();

    rerender(
      <StretchControls params={{ ...defaultParams, stretch: 'asinh' }} onChange={onChange as any} />
    );
    expect(screen.getByText('Asinh Softening')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    renderControls({}, true);
    expect(screen.queryByText('Stretch Function')).not.toBeInTheDocument();
  });

  it('shows body when not collapsed', () => {
    renderControls();
    expect(screen.getByText('Stretch Function')).toBeInTheDocument();
  });

  it('shows Levels title in header', () => {
    renderControls();
    expect(screen.getByText('Levels')).toBeInTheDocument();
  });

  it('shows tone curve select', () => {
    renderControls();
    expect(screen.getByText('Tone Curve')).toBeInTheDocument();
    // The tone curve select should have its options
    const selects = screen.getAllByRole('combobox');
    // Two selects: stretch function and tone curve
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onChange when gamma slider changes', () => {
    renderControls();
    const sliders = screen.getAllByRole('slider');
    // First slider is gamma
    fireEvent.change(sliders[0], { target: { value: '2.0' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gamma: 2.0 }));
  });

  it('shows reset button when not collapsed', () => {
    renderControls();
    expect(screen.getByTitle('Reset to defaults')).toBeInTheDocument();
  });

  it('hides reset button when collapsed', () => {
    renderControls({}, true);
    expect(screen.queryByTitle('Reset to defaults')).not.toBeInTheDocument();
  });

  it('reset button resets to defaults', () => {
    renderControls({ stretch: 'log', gamma: 2.5 });
    fireEvent.click(screen.getByTitle('Reset to defaults'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        stretch: 'zscale',
        gamma: 1.0,
        blackPoint: 0.0,
        whitePoint: 1.0,
        asinhA: 0.1,
        curve: 'linear',
      })
    );
  });

  it('shows stretch description hint', () => {
    renderControls();
    expect(screen.getByText('Automatic robust scaling (default)')).toBeInTheDocument();
  });
});
