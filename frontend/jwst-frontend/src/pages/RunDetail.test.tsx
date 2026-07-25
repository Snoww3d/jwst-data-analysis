/**
 * Run detail (#1734). These cases moved here from CalibrateRun.test.tsx along
 * with the progress/outputs UI — the run now has its own page and URL.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

function renderRun() {
  return render(
    <MemoryRouter initialEntries={['/calibrate/runs/job-1']}>
      <Routes>
        <Route path="/calibrate/runs/:jobId" element={<RunDetail />} />
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
    await waitFor(() => expect(screen.getByText('image2')).toBeInTheDocument());
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
