import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionStatisticsPanel from './RegionStatisticsPanel';

const mockStats = {
  pixelCount: 1500,
  mean: 42.5678,
  median: 41.234,
  std: 5.6789,
  min: 10.1234,
  max: 99.5678,
  sum: 63851.7,
};

describe('RegionStatisticsPanel', () => {
  const defaultProps = {
    stats: null as typeof mockStats | null,
    loading: false,
    error: null as string | null,
    onClear: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows header "Region Statistics" always', () => {
    render(<RegionStatisticsPanel {...defaultProps} />);
    expect(screen.getByText('Region Statistics')).toBeInTheDocument();
  });

  it('shows header even when collapsed', () => {
    render(<RegionStatisticsPanel {...defaultProps} collapsed={true} />);
    expect(screen.getByText('Region Statistics')).toBeInTheDocument();
  });

  it('when collapsed, body is hidden', () => {
    const { container } = render(<RegionStatisticsPanel {...defaultProps} collapsed={true} />);

    const body = container.querySelector('.region-stats-body');
    expect(body).not.toBeInTheDocument();
  });

  it('when not collapsed + loading: shows "Computing..." spinner', () => {
    const { container } = render(<RegionStatisticsPanel {...defaultProps} loading={true} />);

    expect(screen.getByText('Computing...')).toBeInTheDocument();
    const spinner = container.querySelector('.mini-spinner');
    expect(spinner).toBeInTheDocument();
  });

  it('when not collapsed + error: shows error message', () => {
    render(<RegionStatisticsPanel {...defaultProps} error="Failed to compute statistics" />);

    expect(screen.getByText('Failed to compute statistics')).toBeInTheDocument();
  });

  it('when not collapsed + stats: shows all stat values', () => {
    render(<RegionStatisticsPanel {...defaultProps} stats={mockStats} />);

    expect(screen.getByText('Pixels')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('Mean')).toBeInTheDocument();
    expect(screen.getByText('42.5678')).toBeInTheDocument();
    expect(screen.getByText('Median')).toBeInTheDocument();
    expect(screen.getByText('41.2340')).toBeInTheDocument();
    expect(screen.getByText('Std Dev')).toBeInTheDocument();
    expect(screen.getByText('5.6789')).toBeInTheDocument();
    expect(screen.getByText('Min')).toBeInTheDocument();
    expect(screen.getByText('10.1234')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('99.5678')).toBeInTheDocument();
    expect(screen.getByText('Sum')).toBeInTheDocument();
    expect(screen.getByText('63851.7000')).toBeInTheDocument();
  });

  it('when not collapsed + no stats + no loading + no error: shows empty message', () => {
    render(<RegionStatisticsPanel {...defaultProps} />);

    expect(screen.getByText('Draw a region on the image')).toBeInTheDocument();
  });

  it('clear button calls onClear', () => {
    const onClear = vi.fn();
    render(<RegionStatisticsPanel {...defaultProps} onClear={onClear} />);

    const clearButton = screen.getByTitle('Clear region');
    fireEvent.click(clearButton);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('header click calls onToggleCollapse', () => {
    const onToggleCollapse = vi.fn();
    const { container } = render(
      <RegionStatisticsPanel {...defaultProps} onToggleCollapse={onToggleCollapse} />
    );

    const header = container.querySelector('.region-stats-header');
    if (!header) throw new Error('Expected .region-stats-header element');
    fireEvent.click(header);
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('formatStatValue: scientific notation for small values (<0.001)', () => {
    const smallStats = {
      ...mockStats,
      mean: 0.00005678,
    };
    render(<RegionStatisticsPanel {...defaultProps} stats={smallStats} />);

    // 0.00005678 should be rendered in scientific notation
    expect(screen.getByText('5.6780e-5')).toBeInTheDocument();
  });

  it('formatStatValue: scientific notation for large values (>999999)', () => {
    const largeStats = {
      ...mockStats,
      sum: 1234567.89,
    };
    render(<RegionStatisticsPanel {...defaultProps} stats={largeStats} />);

    // 1234567.89 should be rendered in scientific notation
    expect(screen.getByText('1.2346e+6')).toBeInTheDocument();
  });
});
