import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CalibrateRun from './CalibrateRun';
import type { CalibrationRecipe } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  getRecipe: vi.fn(),
  startRun: vi.fn(),
}));
vi.mock('../services/jwstDataService', () => ({
  getAll: vi.fn().mockResolvedValue([]),
}));

import { getRecipe, startRun } from '../services/calibrationService';
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

/** Renders the page alongside a stub run route so navigation is observable. */
function renderPage(initialEntry: string | object = '/calibrate/seed-nircam-imaging') {
  return render(
    <MemoryRouter initialEntries={[initialEntry as string]}>
      <Routes>
        <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CalibrateRun', () => {
  beforeEach(() => {
    vi.mocked(getRecipe).mockResolvedValue(recipe);
    vi.mocked(getAll).mockResolvedValue([]);
  });

  it('renders stage toggles and seeded parameters as curated controls', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());
    // jump.maximum_cores is catalogued, so it gets a real labelled select
    // rather than three free-text boxes (#1737).
    const cores = screen.getByLabelText('Jump detection — CPU cores');
    expect(cores).toHaveValue('half');
    expect(cores.tagName).toBe('SELECT');
    expect(screen.getByText(/Data is fetched from MAST/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
  });

  it('submits the value chosen from a curated control', async () => {
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Jump detection — CPU cores'), 'all');
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));

    expect(vi.mocked(startRun)).toHaveBeenCalledWith(
      expect.objectContaining({ runOverrides: { jump: { maximum_cores: 'all' } } })
    );
  });

  it('keeps uncatalogued parameters in the Advanced raw editor', async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      ...recipe,
      stages: [
        {
          name: 'image3',
          enabled: true,
          step_overrides: { tweakreg: { some_exotic_knob: 1.5 } },
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());

    expect(screen.getByText(/Advanced — raw step parameters/)).toBeInTheDocument();
    expect(screen.getByLabelText('Step for parameter 1')).toHaveValue('tweakreg');
    expect(screen.getByLabelText('Name for parameter 1')).toHaveValue('some_exotic_knob');
  });

  it('starts a run and hands off to the run URL', async () => {
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-1' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));

    expect(vi.mocked(startRun)).toHaveBeenCalledWith({
      recipeId: 'seed-nircam-imaging',
      inputs: [],
      runOverrides: { jump: { maximum_cores: 'half' } },
      enabledStages: { detector1: true, image2: true, image3: true },
    });
    // The run lives at its own URL from the moment it starts (#1734) — the
    // config page no longer owns the job id.
    expect(await screen.findByText('run detail stub')).toBeInTheDocument();
  });

  it('keeps the form usable when the run fails to start', async () => {
    vi.mocked(startRun).mockRejectedValue(new Error('engine down'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));

    expect(await screen.findByText(/engine down/)).toBeInTheDocument();
    // Still on the config page, and the button is live again for a retry.
    expect(screen.getByText('Stages')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run calibration' })).toBeEnabled()
    );
  });

  it('rehydrates the form from a re-run hand-off (#1735)', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: {
              rerun: {
                enabledStages: { detector1: false, image2: false, image3: true },
                runOverrides: { skymatch: { skymethod: 'global+match' } },
                inputs: ['mast/jw1/a_cal.fits'],
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Stages')).toBeInTheDocument());

    // The previous run's toggles win over the recipe's own defaults...
    expect(screen.getByRole('checkbox', { name: /Image3/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Detector1/ })).not.toBeChecked();
    // ...and its parameters replace the seeded ones rather than merging.
    expect(screen.getByLabelText('Sky matching method')).toHaveValue('global+match');
    expect(screen.queryByLabelText('Jump detection — CPU cores')).not.toBeInTheDocument();
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
    const image3 = screen.getByRole('checkbox', { name: /Image3/ });
    const detector1 = screen.getByRole('checkbox', { name: /Detector1/ });
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
    const a = await screen.findByRole('checkbox', { name: /a_cal\.fits/ });
    const b = screen.getByRole('checkbox', { name: /b_cal\.fits/ });
    expect(a).toBeChecked();
    expect(b).not.toBeChecked();
    expect(screen.queryByText(/No matching library files/)).not.toBeInTheDocument();
  });
});
