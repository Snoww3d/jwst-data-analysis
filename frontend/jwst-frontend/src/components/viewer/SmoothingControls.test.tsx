import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SmoothingControls from './SmoothingControls';
import type { SmoothingParams } from '../../types/AnalysisTypes';

describe('SmoothingControls', () => {
  const defaultParams: SmoothingParams = { method: '', sigma: 1.0, size: 3 };

  it('renders the panel header', () => {
    render(<SmoothingControls params={defaultParams} onChange={vi.fn()} />);
    expect(screen.getByText('Smoothing')).toBeInTheDocument();
  });

  it('renders method select when not collapsed', () => {
    render(<SmoothingControls params={defaultParams} onChange={vi.fn()} collapsed={false} />);
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    render(<SmoothingControls params={defaultParams} onChange={vi.fn()} collapsed={true} />);
    expect(screen.getByText('Smoothing')).toBeInTheDocument();
    expect(screen.queryByText('Method')).not.toBeInTheDocument();
  });
});
