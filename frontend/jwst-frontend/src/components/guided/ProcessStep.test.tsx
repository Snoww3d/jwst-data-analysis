import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcessStep } from './ProcessStep';

const baseProps = {
  targetName: 'NGC 346',
  recipeName: 'NASA NIRCam',
  requiresMosaic: false,
  phase: 'composite' as const,
  progress: null,
  isComplete: false,
  channelCount: 3,
  fileCount: 12,
};

describe('ProcessStep — Continue anyway override', () => {
  it('renders only Retry Processing when error is unrelated', () => {
    const onRetry = vi.fn();
    render(<ProcessStep {...baseProps} error="Network error: ECONNREFUSED" onRetry={onRetry} />);

    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull();
  });

  it('renders Continue anyway when error matches MEMORY_BUDGET: prefix', () => {
    const onRetry = vi.fn();
    const onContinueAnyway = vi.fn();
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={onRetry}
        onContinueAnyway={onContinueAnyway}
      />
    );

    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /continue anyway/i });
    expect(continueBtn).toBeInTheDocument();
    // Projected output shape parsed from the engine detail.
    expect(continueBtn.textContent).toMatch(/4353×3417/);
  });

  it('strips MEMORY_BUDGET: prefix from displayed error text', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={vi.fn()}
      />
    );

    // The literal MEMORY_BUDGET: prefix must not leak into user-visible copy.
    expect(screen.queryByText(/MEMORY_BUDGET:/)).toBeNull();
    expect(screen.getByText(/Composite output would shrink to 38%/)).toBeInTheDocument();
  });

  it('detects memory-budget pattern in sync-path errors without prefix', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={
          'Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /continue anyway/i })).toBeInTheDocument();
  });

  it('clicking Continue anyway calls onContinueAnyway', () => {
    const onContinueAnyway = vi.fn();
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% (4353x3417 from 11399x8949). ' +
          'Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={onContinueAnyway}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }));
    expect(onContinueAnyway).toHaveBeenCalledTimes(1);
  });

  it('does NOT render Continue anyway when onContinueAnyway is omitted (back-compat)', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={'MEMORY_BUDGET:Composite output would shrink to 38% (4353x3417 from 11399x8949).'}
        onRetry={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull();
  });
});
