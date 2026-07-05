import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImportProgressPill } from './ImportProgressPill';
import type { ActiveImportJob } from '../../hooks/useActiveImports';

const hoisted = vi.hoisted(() => ({
  useActiveImportsContextMock: vi.fn(),
}));

vi.mock('../../context/useActiveImportsContext', () => ({
  useActiveImportsContext: hoisted.useActiveImportsContextMock,
}));

function mockJobs(
  jobs: ActiveImportJob[],
  overrides: { aggregatePercent?: number; activeCount?: number } = {}
) {
  hoisted.useActiveImportsContextMock.mockReturnValue({
    jobs,
    aggregatePercent: overrides.aggregatePercent ?? 0,
    activeCount: overrides.activeCount ?? jobs.length,
    registerJob: vi.fn(),
  });
}

function renderPill() {
  return render(
    <MemoryRouter>
      <ImportProgressPill />
    </MemoryRouter>
  );
}

describe('ImportProgressPill', () => {
  it('renders no visible pill when there are no active jobs', () => {
    mockJobs([]);
    renderPill();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps an aria-live region mounted (empty) even with no active jobs', () => {
    mockJobs([]);
    const { container } = renderPill();
    // The live region stays in the DOM at all times so screen readers pick
    // up the very first announcement once a job starts — see component doc.
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent('');
  });

  it('renders single-job percent text', () => {
    mockJobs([{ jobId: 'job-1', obsId: 'obs-1', percent: 46, status: 'running' }], {
      aggregatePercent: 46,
      activeCount: 1,
    });
    renderPill();
    expect(screen.getAllByText('Importing… 46%').length).toBeGreaterThan(0);
  });

  it('renders aggregate text for multiple jobs', () => {
    mockJobs(
      [
        { jobId: 'job-1', obsId: 'obs-1', percent: 30, status: 'running' },
        { jobId: 'job-2', obsId: 'obs-2', percent: 62, status: 'running' },
      ],
      { aggregatePercent: 46, activeCount: 2 }
    );
    renderPill();
    expect(screen.getAllByText('Importing 2 · 46%').length).toBeGreaterThan(0);
  });

  it('links to /archive', () => {
    mockJobs([{ jobId: 'job-1', obsId: 'obs-1', percent: 10, status: 'running' }], {
      aggregatePercent: 10,
      activeCount: 1,
    });
    renderPill();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/archive');
  });

  it('shows a success state when all jobs have completed', () => {
    mockJobs([{ jobId: 'job-1', obsId: 'obs-1', percent: 100, status: 'complete' }], {
      aggregatePercent: 100,
      activeCount: 1,
    });
    renderPill();
    expect(screen.getAllByText('Import complete').length).toBeGreaterThan(0);
    expect(screen.getByRole('link')).toHaveClass('import-progress-success');
  });
});
