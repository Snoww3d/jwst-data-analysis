/**
 * Run detail (#1734). These cases moved here from CalibrateRun.test.tsx along
 * with the progress/outputs UI — the run now has its own page and URL.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import RunDetail from './RunDetail';
import type { CalibrationJob } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  getJob: vi.fn(),
  cancelJob: vi.fn(),
  getJobOutputPreview: vi.fn(),
  saveJobOutputToLibrary: vi.fn(),
  downloadJobOutput: vi.fn(),
}));

import {
  getJob,
  getJobOutputPreview,
  saveJobOutputToLibrary,
} from '../services/calibrationService';

function runningJob(): CalibrationJob {
  return {
    jobId: 'job-1',
    type: 'calibration',
    status: 'running',
    cancelRequested: false,
    createdAt: '2026-07-24T00:00:00Z',
    startedAt: '2026-07-24T00:00:01Z',
    finishedAt: null,
    progress: {
      stages: [
        { name: 'detector1', status: 'done' },
        { name: 'image2', status: 'running' },
        { name: 'image3', status: 'pending' },
      ],
      currentStage: 'image2',
      message: 'running image2',
      downloadPct: null,
    },
    logTail: ['Step flat_field running'],
    result: null,
    error: null,
    request: {},
  };
}

function succeededJob(): CalibrationJob {
  return {
    ...runningJob(),
    status: 'succeeded',
    finishedAt: '2026-07-24T00:05:00Z',
    result: {
      outputs: [
        { storageKey: 'calibration/job-1/jw001_i2d.fits', suffix: '_i2d', sizeBytes: 5242880 },
        { storageKey: 'calibration/job-1/jw001_cat.ecsv', suffix: '_cat', sizeBytes: 2048 },
      ],
      jwstVersion: '1.14.0',
      crdsContext: 'jwst_1234.pmap',
    },
  };
}

/** A run's stored request: the engine embeds the snapshot with the run's own
 *  stage toggles already applied, which is what makes re-run possible. */
function withRequest(job: CalibrationJob, enabled: Record<string, boolean>): CalibrationJob {
  return {
    ...job,
    request: {
      recipe_id: 'seed-nircam-imaging',
      recipe_snapshot: {
        name: 'NIRCam Imaging',
        stages: Object.entries(enabled).map(([name, en]) => ({
          name,
          enabled: en,
          step_overrides: {},
        })),
      } as never,
      run_overrides: { jump: { maximum_cores: 'half' } },
      inputs: [{ path: 'mast/jw1/a_cal.fits', role: 'science' }],
      input_data_ids: ['lib-a'],
    },
  };
}

function renderRun(extraRoutes?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/calibrate/runs/job-1']}>
      <Routes>
        <Route path="/calibrate/runs/:jobId" element={<RunDetail />} />
        {extraRoutes}
      </Routes>
    </MemoryRouter>
  );
}

describe('RunDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('reads the job id from the URL and shows live progress', async () => {
    vi.mocked(getJob).mockResolvedValue(runningJob());
    renderRun();

    // The id comes from the route, so the page works on a cold load/refresh.
    expect(vi.mocked(getJob)).toHaveBeenCalledWith('job-1');
    await waitFor(() => expect(screen.getByText('Image2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it('explains why a queued run is waiting', async () => {
    vi.mocked(getJob).mockResolvedValue({ ...runningJob(), status: 'queued' });
    renderRun();
    expect(await screen.findByText(/one calibration at a time/)).toBeInTheDocument();
  });

  it('shows the failure state', async () => {
    vi.mocked(getJob).mockResolvedValue({
      ...runningJob(),
      status: 'failed' as const,
      error: 'boom',
    });
    renderRun();
    await waitFor(() => expect(screen.getByText(/Run failed: boom/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  describe('configuration summary and re-run', () => {
    it('shows what the run was started with, while it is still running', async () => {
      vi.mocked(getJob).mockResolvedValue(
        withRequest(runningJob(), { detector1: false, image2: false, image3: true })
      );
      renderRun();

      await waitFor(() => expect(screen.getByText('Configuration')).toBeInTheDocument());
      // Scope to the summary: the progress checklist also lists stage names.
      const stagesRow = screen.getByText('Stages:').closest('li');
      expect(stagesRow).toHaveTextContent('image3');
      // Only the stages that actually ran — the disabled ones are omitted.
      expect(stagesRow).not.toHaveTextContent('detector1');
      expect(screen.getByText(/jump\.maximum_cores/)).toBeInTheDocument();
      expect(screen.getByText(/1 file/)).toBeInTheDocument();
      // Re-run is for finished runs only — this one is still going.
      expect(screen.queryByRole('button', { name: 'Re-run with changes' })).not.toBeInTheDocument();
    });

    it('offers re-run once the job is terminal and carries the settings across', async () => {
      vi.mocked(getJob).mockResolvedValue(
        withRequest(succeededJob(), { detector1: false, image2: false, image3: true })
      );
      let handedOff: unknown = null;
      function ConfigStub() {
        handedOff = useLocation().state;
        return <div>config stub</div>;
      }
      renderRun(<Route path="/calibrate/:recipeId" element={<ConfigStub />} />);

      await userEvent.click(await screen.findByRole('button', { name: 'Re-run with changes' }));

      expect(await screen.findByText('config stub')).toBeInTheDocument();
      // Toggles, overrides AND the source library items travel to the form.
      // The ids matter: a storage key can't be turned back into a library item,
      // so without them a re-run of a library run would silently become a fresh
      // MAST download (#1751). stage3Only is derived from the _cal inputs.
      expect(handedOff).toEqual({
        rerun: {
          enabledStages: { detector1: false, image2: false, image3: true },
          runOverrides: { jump: { maximum_cores: 'half' } },
          inputDataIds: ['lib-a'],
        },
        stage3Only: true,
      });
    });

    it('a MAST run re-runs as a MAST run — no phantom library inputs', async () => {
      const job = withRequest(succeededJob(), { detector1: true, image2: true, image3: true });
      job.request.inputs = [];
      job.request.input_data_ids = [];
      vi.mocked(getJob).mockResolvedValue(job);
      let handedOff: unknown = null;
      function ConfigStub() {
        handedOff = useLocation().state;
        return <div>config stub</div>;
      }
      renderRun(<Route path="/calibrate/:recipeId" element={<ConfigStub />} />);

      await userEvent.click(await screen.findByRole('button', { name: 'Re-run with changes' }));
      await screen.findByText('config stub');
      // stage3Only must stay false, or the config page would switch to the
      // library picker for a run that fetches its own data.
      expect(handedOff).toMatchObject({ stage3Only: false, rerun: { inputDataIds: [] } });
    });

    it('will not offer a misleading re-run for a job that predates input tracking', async () => {
      // Only storage keys, no ids: the source items can't be re-selected, and
      // re-running would silently become a fresh MAST download (#1751).
      const job = withRequest(succeededJob(), { image3: true });
      delete job.request.input_data_ids;
      vi.mocked(getJob).mockResolvedValue(job);
      renderRun();
      const button = await screen.findByRole('button', { name: 'Re-run with changes' });
      expect(button).toBeDisabled();
      // The reason must be on the page, not in a title a disabled control
      // never surfaces and assistive tech never announces.
      expect(button).toHaveAttribute('aria-describedby', 'rerun-unavailable-reason');
      // By id: the page has other live regions (progress).
      expect(document.getElementById('rerun-unavailable-reason')).toHaveTextContent(
        /predates input tracking/
      );
    });

    it('offers re-run on a failed run too — that is when you most want to tweak', async () => {
      vi.mocked(getJob).mockResolvedValue(
        withRequest({ ...runningJob(), status: 'failed', error: 'boom' }, { image3: true })
      );
      renderRun();
      expect(
        await screen.findByRole('button', { name: 'Re-run with changes' })
      ).toBeInTheDocument();
    });
  });

  describe('outputs', () => {
    beforeEach(() => {
      vi.mocked(getJob).mockResolvedValue(succeededJob());
    });

    it('renders FITS outputs as buttons and non-FITS as plain text', async () => {
      renderRun();
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /jw001_i2d\.fits/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /jw001_cat\.ecsv/ })).not.toBeInTheDocument();
      expect(screen.getByText(/not an image/)).toBeInTheDocument();
    });

    it('opens the lightbox with the rendered preview when an output is clicked', async () => {
      vi.mocked(getJobOutputPreview).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
      renderRun();
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: /jw001_i2d\.fits/ }));

      expect(vi.mocked(getJobOutputPreview)).toHaveBeenCalledWith('job-1', 0);
      expect(await screen.findByRole('dialog', { name: 'jw001_i2d.fits' })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'jw001_i2d.fits' })).not.toBeInTheDocument()
      );
    });

    it('saves a FITS output and then offers the compositor hop', async () => {
      vi.mocked(saveJobOutputToLibrary).mockResolvedValue({ dataId: 'abc123', created: true });
      renderRun();
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());

      expect(screen.queryByRole('link', { name: 'Open in compositor' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Save to library' }));

      expect(vi.mocked(saveJobOutputToLibrary)).toHaveBeenCalledWith('job-1', 0);
      expect(await screen.findByText('✓ In library')).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: 'Open in compositor' })).toBeInTheDocument();
    });

    it('keeps the run usable when saving fails', async () => {
      vi.mocked(saveJobOutputToLibrary).mockRejectedValue(new Error('mongo is down'));
      renderRun();
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Save to library' }));

      expect(await screen.findByRole('button', { name: 'Save to library' })).toBeEnabled();
      expect(screen.queryByText('✓ In library')).not.toBeInTheDocument();
    });

    it('offers download for a catalog, which cannot be saved as an image', async () => {
      renderRun();
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());
      expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'Save to library' })).toHaveLength(1);
    });
  });
});
