/**
 * Run history (#1734) — the first consumer of the engine's job list.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalibrationRuns from './CalibrationRuns';
import type { CalibrationJob } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  listJobs: vi.fn(),
}));
const authState: { isAuthenticated: boolean; user: { role: string } | null } = {
  isAuthenticated: true,
  user: { role: 'User' },
};
vi.mock('../context/useAuth', () => ({ useAuth: () => authState }));

import { listJobs } from '../services/calibrationService';

function job(over: Partial<CalibrationJob> & { jobId: string }): CalibrationJob {
  return {
    type: 'calibration',
    status: 'succeeded',
    cancelRequested: false,
    createdAt: '2026-07-24T00:00:00Z',
    startedAt: '2026-07-24T00:00:00Z',
    finishedAt: '2026-07-24T00:30:00Z',
    progress: { stages: [], currentStage: null, message: null, downloadPct: null },
    logTail: [],
    result: { outputs: [], jwstVersion: null, crdsContext: null },
    error: null,
    request: {},
    ...over,
  } as CalibrationJob;
}

function renderRuns() {
  return render(
    <MemoryRouter>
      <CalibrationRuns />
    </MemoryRouter>
  );
}

describe('CalibrationRuns', () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.user = { role: 'User' };
  });

  it('keeps navigation and points anonymous visitors at the public recipes', async () => {
    // Regression: /calibrate is a public route but runs need auth, so the page
    // used to dead-end on "Not authenticated" with no way out.
    authState.isAuthenticated = false;
    renderRuns();

    expect(await screen.findByText('Sign in to see your calibration runs')).toBeInTheDocument();
    // The header survives — a failed/By-design-empty fetch must not strip nav.
    expect(screen.getByRole('heading', { name: 'Calibration runs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ New run' })).toBeInTheDocument();
    expect(vi.mocked(listJobs)).not.toHaveBeenCalled();
  });

  it('keeps navigation when the run list fails to load', async () => {
    vi.mocked(listJobs).mockRejectedValue(new Error('engine unreachable'));
    renderRuns();
    expect(await screen.findByText("Couldn't load your runs")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ New run' })).toBeInTheDocument();
  });
  it('separates active runs from history and links each to its own URL', async () => {
    vi.mocked(listJobs).mockResolvedValue([
      job({ jobId: 'run-active', status: 'running', finishedAt: null }),
      job({ jobId: 'run-done' }),
    ]);
    renderRuns();

    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(screen.getByText('History')).toBeInTheDocument();
    // Each run is reachable at a durable URL — the point of the page.
    expect(screen.getByRole('link', { name: 'run-active' })).toHaveAttribute(
      'href',
      '/calibrate/runs/run-active'
    );
    expect(screen.getByRole('link', { name: 'run-done' })).toHaveAttribute(
      'href',
      '/calibrate/runs/run-done'
    );
  });

  it('explains that a queued run is waiting on the single-run limit', async () => {
    vi.mocked(listJobs).mockResolvedValue([
      job({ jobId: 'run-q', status: 'queued', startedAt: null, finishedAt: null }),
    ]);
    renderRuns();
    expect(await screen.findByText(/one calibration at a time/)).toBeInTheDocument();
  });

  it('invites a first run when there is no history', async () => {
    vi.mocked(listJobs).mockResolvedValue([]);
    renderRuns();
    expect(await screen.findByText('No calibration runs yet')).toBeInTheDocument();
  });

  it('surfaces the failure reason', async () => {
    vi.mocked(listJobs).mockRejectedValue(new Error('engine unreachable'));
    renderRuns();
    expect(await screen.findByText('engine unreachable')).toBeInTheDocument();
  });

  // #1807: get_job and the output routes have an Admin bypass; this list did
  // not. An admin could OPEN any run but never FIND one, because job ids are
  // UUIDs — so admin observability was unusable in practice.
  describe('admin visibility', () => {
    it('does not offer the all-users view to a normal user', async () => {
      vi.mocked(listJobs).mockResolvedValue([]);
      renderRuns();

      await screen.findByText('No calibration runs yet');
      expect(screen.queryByLabelText('All users')).not.toBeInTheDocument();
      expect(vi.mocked(listJobs)).toHaveBeenCalledWith(50, false);
    });

    it('offers it to an admin, still defaulting to their own runs', async () => {
      authState.user = { role: 'Admin' };
      vi.mocked(listJobs).mockResolvedValue([]);
      renderRuns();

      expect(await screen.findByLabelText('All users')).not.toBeChecked();
      // Opt-in: an admin's own history is the default view.
      expect(vi.mocked(listJobs)).toHaveBeenCalledWith(50, false);
    });

    it("asks for every user's runs and labels whose each one is", async () => {
      authState.user = { role: 'Admin' };
      vi.mocked(listJobs).mockResolvedValue([]);
      renderRuns();

      vi.mocked(listJobs).mockResolvedValue([
        job({ jobId: 'run-mine', userId: 'admin-a' }),
        job({ jobId: 'run-theirs', userId: 'user-b' }),
      ]);
      fireEvent.click(await screen.findByLabelText('All users'));

      await waitFor(() => expect(vi.mocked(listJobs)).toHaveBeenCalledWith(50, true));
      // Rows are no longer all the caller's, so each says whose it is.
      expect(await screen.findByText('user-b')).toBeInTheDocument();
      expect(screen.getByText('admin-a')).toBeInTheDocument();
    });

    it('shows no owner labels in the default single-user view', async () => {
      authState.user = { role: 'Admin' };
      vi.mocked(listJobs).mockResolvedValue([job({ jobId: 'run-mine', userId: 'admin-a' })]);
      renderRuns();

      await screen.findByText('run-mine');
      expect(screen.queryByText('admin-a')).not.toBeInTheDocument();
    });
  });
});
