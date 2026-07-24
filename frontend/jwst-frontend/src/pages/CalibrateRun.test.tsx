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
}));
vi.mock('../services/jwstDataService', () => ({
  getAll: vi.fn().mockResolvedValue([]),
}));

import { getJob, getRecipe, startRun } from '../services/calibrationService';

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
});
