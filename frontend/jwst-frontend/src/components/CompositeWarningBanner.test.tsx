import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompositeWarningBanner } from './CompositeWarningBanner';
import type { CompositeWarning } from '../types/CompositeTypes';

describe('CompositeWarningBanner', () => {
  it('renders nothing when warning is null', () => {
    const { container } = render(<CompositeWarningBanner warning={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is ok (no useful signal)', () => {
    const warning: CompositeWarning = {
      budgetStatus: 'ok',
      wasDownscaled: false,
    };
    const { container } = render(<CompositeWarningBanner warning={warning} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows reduction details when wasDownscaled', () => {
    const warning: CompositeWarning = {
      budgetStatus: 'warn',
      wasDownscaled: true,
      originalShape: [5750, 5750],
      outputShape: [5462, 5462],
      sideFactor: 0.95,
    };
    render(<CompositeWarningBanner warning={warning} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Output reduced to fit memory budget/i)).toBeInTheDocument();
    expect(screen.getByText(/5462×5462px from 5750×5750px/)).toBeInTheDocument();
    expect(screen.getByText(/95% of original side length/)).toBeInTheDocument();
  });

  it('shows fail-mode message for stale-cache fail status', () => {
    const warning: CompositeWarning = {
      budgetStatus: 'fail',
      wasDownscaled: false,
    };
    render(<CompositeWarningBanner warning={warning} />);

    expect(
      screen.getByText(/Result served from cache exceeds current memory budget/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/MAX_COMPOSITE_MEMORY_BYTES/)).toBeInTheDocument();
  });

  it('hides after dismiss button is clicked', () => {
    const warning: CompositeWarning = {
      budgetStatus: 'warn',
      wasDownscaled: true,
      originalShape: [1000, 1000],
      outputShape: [800, 800],
      sideFactor: 0.8,
    };
    const { container } = render(<CompositeWarningBanner warning={warning} />);
    expect(container.firstChild).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /dismiss warning/i }));
    expect(container.firstChild).toBeNull();
  });

  it('reveals again when a fresh warning arrives after dismissal', () => {
    const initial: CompositeWarning = {
      budgetStatus: 'warn',
      wasDownscaled: true,
      originalShape: [1000, 1000],
      outputShape: [800, 800],
      sideFactor: 0.8,
    };
    const { rerender, container } = render(<CompositeWarningBanner warning={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss warning/i }));
    expect(container.firstChild).toBeNull();

    // A stricter downscale arrives — banner must reveal, not stay dismissed.
    const next: CompositeWarning = {
      budgetStatus: 'warn',
      wasDownscaled: true,
      originalShape: [1000, 1000],
      outputShape: [600, 600],
      sideFactor: 0.6,
    };
    rerender(<CompositeWarningBanner warning={next} />);

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/600×600px from 1000×1000px/)).toBeInTheDocument();
  });
});
