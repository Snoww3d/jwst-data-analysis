import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CalibrateRun from './CalibrateRun';
import type { CalibrationJob, CalibrationRecipe } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  getRecipe: vi.fn(),
  startRun: vi.fn(),
  cancelJob: vi.fn(),
  getJob: vi.fn(),
  getJobOutputPreview: vi.fn(),
  saveJobOutputToLibrary: vi.fn(),
  downloadJobOutput: vi.fn(),
}));
vi.mock('../services/jwstDataService', () => ({
  getAll: vi.fn().mockResolvedValue([]),
}));

import {
  getJob,
  getJobOutputPreview,
  getRecipe,
  saveJobOutputToLibrary,
  startRun,
} from '../services/calibrationService';
import { getAll } from '../services/jwstDataService';

const recipe: CalibrationRecipe = {
  id: 'seed-nircam-imaging',
  schema_version: 1,
  name: 'NIRCam Imaging',
  description: 'Full reduction.',
  instrument: 'nircam',
  mode: 'imaging',
  source: 'seed',
  is_public: true,
  provenance: { notebook_name: null, jwst_version_authored: null },
  input_source: {
    type: 'mast_query',
    proposal_id: '2739',
    observation: '001',
    filters: ['F200W'],
    calib_level: 1,
    product_suffixes: ['_uncal'],
  },
  stages: [
    { name: 'detector1', enabled: true, step_overrides: { jump: { maximum_cores: 'half' } } },
    { name: 'image2', enabled: true, step_overrides: {} },
    { name: 'image3', enabled: true, step_overrides: {} },
  ],
  association: { rule: 'DMS_Level3_Base', product_name: 'nircam-imaging' },
  output_suffixes: ['_i2d'],
  created_by: null,
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
};

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/calibrate/seed-nircam-imaging']}>
      <Routes>
        <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CalibrateRun', () => {
  beforeEach(() => {
    vi.mocked(getRecipe).mockResolvedValue(recipe);
    vi.mocked(getAll).mockResolvedValue([]);
  });

  it('renders stage toggles and seeded parameters', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
    expect(screen.getByLabelText('Step for parameter 1')).toHaveValue('jump');
    expect(screen.getByLabelText('Name for parameter 1')).toHaveValue('maximum_cores');
    expect(screen.getByText(/Data is fetched from MAST/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
  });

  it('starts a run and shows live progress', async () => {
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(getJob).mockResolvedValue(runningJob());
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(screen.getByText('Run progress')).toBeInTheDocument());
    expect(vi.mocked(startRun)).toHaveBeenCalledWith({
      recipeId: 'seed-nircam-imaging',
      inputs: [],
      runOverrides: { jump: { maximum_cores: 'half' } },
      enabledStages: { detector1: true, image2: true, image3: true },
    });
    await waitFor(() => expect(screen.getByText('image2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it('shows the failure state', async () => {
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
    const failed = { ...runningJob(), status: 'failed' as const, error: 'boom' };
    vi.mocked(getJob).mockResolvedValue(failed);
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(screen.getByText(/Run failed: boom/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('reprocess state selects stage-3 only and pre-fills inputs', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputs: ['mast/jw1/a_cal.fits'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
    // Only image3 is checked; the raw stages are unchecked for the fast path.
    const image3 = screen.getByRole('checkbox', { name: /image3/ });
    const detector1 = screen.getByRole('checkbox', { name: /detector1/ });
    expect(image3).toBeChecked();
    expect(detector1).not.toBeChecked();
  });

  it('reprocess shows pre-selected _cal inputs as checked despite the recipe _uncal suffix', async () => {
    vi.mocked(getAll).mockResolvedValue([
      { id: 'a', fileName: 'a_cal.fits', filePath: 'mast/jw1/a_cal.fits' },
      { id: 'b', fileName: 'b_cal.fits', filePath: 'mast/jw1/b_cal.fits' },
    ] as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputs: ['mast/jw1/a_cal.fits'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Inputs')).toBeInTheDocument());
    // Both _cal files listed; the pre-selected one is checked.
    const a = await screen.findByRole('checkbox', { name: /a_cal\.fits/ });
    const b = screen.getByRole('checkbox', { name: /b_cal\.fits/ });
    expect(a).toBeChecked();
    expect(b).not.toBeChecked();
    expect(screen.queryByText(/No matching library files/)).not.toBeInTheDocument();
  });

  describe('output previews', () => {
    beforeEach(() => {
      // jsdom has no object-URL support.
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      });
    });

    async function renderSucceeded() {
      vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
      vi.mocked(getJob).mockResolvedValue(succeededJob());
      renderPage();
      await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());
    }

    it('renders FITS outputs as buttons and non-FITS as plain text', async () => {
      await renderSucceeded();
      expect(screen.getByRole('button', { name: /jw001_i2d\.fits/ })).toBeInTheDocument();
      // The catalog output is not clickable.
      expect(screen.queryByRole('button', { name: /jw001_cat\.ecsv/ })).not.toBeInTheDocument();
      // Copy says "not an image" rather than "not previewable": the catalog is
      // still downloadable, so the reason is the format, not a missing action.
      expect(screen.getByText(/not an image/)).toBeInTheDocument();
    });

    it('opens the lightbox with the rendered preview when an output is clicked', async () => {
      vi.mocked(getJobOutputPreview).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
      await renderSucceeded();

      await userEvent.click(screen.getByRole('button', { name: /jw001_i2d\.fits/ }));

      // Fetched by jobId + output index (index 0), never by raw storage key.
      expect(vi.mocked(getJobOutputPreview)).toHaveBeenCalledWith('job-1', 0);
      const dialog = await screen.findByRole('dialog', { name: 'jw001_i2d.fits' });
      expect(dialog).toBeInTheDocument();
      const img = await screen.findByAltText('jw001_i2d.fits');
      expect(img).toHaveAttribute('src', 'blob:preview');

      // Esc closes it.
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'jw001_i2d.fits' })).not.toBeInTheDocument()
      );
    });
  });

  describe('saving outputs to the library', () => {
    async function renderSucceeded() {
      vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
      vi.mocked(getJob).mockResolvedValue(succeededJob());
      renderPage();
      await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
      await waitFor(() => expect(screen.getByText('Outputs')).toBeInTheDocument());
    }

    it('saves a FITS output and then offers the compositor hop', async () => {
      vi.mocked(saveJobOutputToLibrary).mockResolvedValue({ dataId: 'abc123', created: true });
      await renderSucceeded();

      // Before saving there is no compositor route — the output has no library id yet.
      expect(screen.queryByRole('button', { name: 'Open in compositor' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Save to library' }));

      expect(vi.mocked(saveJobOutputToLibrary)).toHaveBeenCalledWith('job-1', 0);
      expect(await screen.findByText('✓ In library')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Open in compositor' })).toBeInTheDocument();
    });

    it('keeps the run usable when saving fails', async () => {
      vi.mocked(saveJobOutputToLibrary).mockRejectedValue(new Error('mongo is down'));
      await renderSucceeded();

      await userEvent.click(screen.getByRole('button', { name: 'Save to library' }));

      // The button returns to its resting state so the user can retry.
      expect(await screen.findByRole('button', { name: 'Save to library' })).toBeEnabled();
      expect(screen.queryByText('✓ In library')).not.toBeInTheDocument();
    });

    it('offers download for a catalog, which cannot be saved as an image', async () => {
      await renderSucceeded();
      // Two outputs: the FITS gets save + download, the catalog download only.
      expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'Save to library' })).toHaveLength(1);
    });
  });
});
