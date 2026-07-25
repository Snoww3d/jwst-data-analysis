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
      inputDataIds: [],
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
                inputDataIds: ['a'],
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
            state: { inputDataIds: ['a'], stage3Only: true },
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
    // Deliberately NO filePath — matching the real DTO (#1751), which is what
    // the old mock got wrong and why this path shipped broken.
    vi.mocked(getAll).mockResolvedValue([
      { id: 'a', fileName: 'a_cal.fits' },
      { id: 'b', fileName: 'b_cal.fits' },
    ] as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['a'], stage3Only: true },
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

  it('always lists a pre-selected file, even when it does not match the recipe suffix', async () => {
    // The filter decides what to BROWSE, never what you may run on. Hiding a
    // preset broke _uncal picks on a reprocess and then _cal picks on a seed
    // recipe — a dead end with no recovery on the page either way.
    vi.mocked(getAll).mockResolvedValue([
      { id: 'c', fileName: 'a_cal.fits' },
      { id: 'u', fileName: 'b_uncal.fits' },
    ] as never);
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-8' } as never);
    render(
      <MemoryRouter
        initialEntries={[
          // Seed recipe browses _uncal; the picked file is _cal.
          { pathname: '/calibrate/seed-nircam-imaging', state: { inputDataIds: ['c'] } },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
          <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
        </Routes>
      </MemoryRouter>
    );
    const cal = await screen.findByRole('checkbox', { name: /a_cal\.fits/ });
    expect(cal).toBeChecked();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(vi.mocked(startRun).mock.lastCall?.[0].inputDataIds).toEqual(['c']);
  });

  it('never submits a stage the page shows as blocked', async () => {
    // The recipe enables detector1, but _cal inputs block it; the timeline
    // renders it off and excludes it from the estimate. Submitting it as on
    // would fail hours into the run.
    vi.mocked(getAll).mockResolvedValue([{ id: 'c', fileName: 'a_cal.fits' }] as never);
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-7' } as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['c'], stage3Only: false },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
          <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('checkbox', { name: /a_cal\.fits/ });
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(vi.mocked(startRun).mock.lastCall?.[0].enabledStages.detector1).toBe(false);
  });

  it('a raw file targeted at L3 enables the whole pipeline', async () => {
    // "take a raw 1 to level 3": the caller names levels, never stages, and
    // all three must be on — the old hand-off could only ever do image3.
    vi.mocked(getAll).mockResolvedValue([{ id: 'u', fileName: 'a_uncal.fits' }] as never);
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-5' } as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['u'], startLevel: 'L1', targetLevel: 'L3' },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
          <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('checkbox', { name: /a_uncal\.fits/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(vi.mocked(startRun).mock.lastCall?.[0].enabledStages).toEqual({
      detector1: true,
      image2: true,
      image3: true,
    });
  });

  it('a calibrated file targeted at L3 runs only the combine step', async () => {
    vi.mocked(getAll).mockResolvedValue([{ id: 'c', fileName: 'a_cal.fits' }] as never);
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-6' } as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: {
              inputDataIds: ['c'],
              startLevel: 'L2b',
              targetLevel: 'L3',
              stage3Only: true,
            },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
          <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('checkbox', { name: /a_cal\.fits/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(vi.mocked(startRun).mock.lastCall?.[0].enabledStages).toEqual({
      detector1: false,
      image2: false,
      image3: true,
    });
  });

  it('data-first hand-off keeps the recipe _uncal filter — it is not a reprocess', async () => {
    // Regression: the _cal override used to fire for ANY preset ids, which
    // made the picker's _uncal selections vanish from this page while still
    // being submitted.
    vi.mocked(getAll).mockResolvedValue([
      { id: 'u', fileName: 'a_uncal.fits' },
      { id: 'c', fileName: 'a_cal.fits' },
    ] as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['u'] },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    const uncal = await screen.findByRole('checkbox', { name: /a_uncal\.fits/ });
    expect(uncal).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /a_cal\.fits/ })).not.toBeInTheDocument();
  });

  it('never submits a pre-selected file it did not show, and says so', async () => {
    vi.mocked(getAll).mockResolvedValue([{ id: 'c', fileName: 'a_cal.fits' }] as never);
    vi.mocked(startRun).mockResolvedValue({ jobId: 'job-9' } as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            // 'ghost' matches the _cal filter in no way the list can show.
            state: { inputDataIds: ['c', 'ghost'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
          <Route path="/calibrate/runs/:jobId" element={<div>run detail stub</div>} />
        </Routes>
      </MemoryRouter>
    );
    // Wait for the list itself first — the loading placeholder is also a
    // status region. Text is interpolated, so assert on the region's content.
    await screen.findByRole('checkbox', { name: /a_cal\.fits/ });
    expect(screen.getByRole('status')).toHaveTextContent(/1 pre-selected file/i);
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    // lastCall, not calls[0]: this file's beforeEach re-stubs the mocks but
    // never clears their call history.
    expect(vi.mocked(startRun).mock.lastCall?.[0].inputDataIds).toEqual(['c']);
  });

  it('does not claim an empty library while the library is still loading', async () => {
    // Guaranteed, not racy: the first render of the Inputs section always has
    // an empty list with the fetch in flight, so an ungated empty state shows
    // "No matching library files found" to every visitor, every time.
    let resolveGetAll: (items: unknown) => void = () => {};
    vi.mocked(getAll).mockReturnValue(
      new Promise((resolve) => {
        resolveGetAll = resolve;
      }) as never
    );
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['c'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );

    // Mid-flight: no false empty state, no "left out" claim, Run held back.
    expect(await screen.findByText('Loading your library…')).toBeInTheDocument();
    expect(screen.queryByText(/No matching library files/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run calibration' })).toBeDisabled();

    resolveGetAll([{ id: 'c', fileName: 'a_cal.fits' }]);
    expect(await screen.findByRole('checkbox', { name: /a_cal\.fits/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
  });

  it('does not tell you to choose a file when there are none to choose', async () => {
    // Regression: the disabled-Run hint fired "Choose at least one input file
    // above." over an empty list and over a failed load — a disabled button
    // plus an instruction you cannot follow, which is the dead end the hint
    // was added to remove.
    vi.mocked(getAll).mockResolvedValue([{ id: 'x', fileName: 'x_i2d.fits' }] as never);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            // A preset that is gone, and nothing in the library matches _cal.
            state: { inputDataIds: ['ghost'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/No matching library files/)).toBeInTheDocument();
    expect(screen.queryByText(/Choose at least one input file/)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Run calibration' });
    expect(button).toBeDisabled();
    // The reason given is the one the user can act on, and it is announced.
    expect(button).toHaveAttribute('aria-describedby', 'run-blocked-reason');
    expect(screen.getByText(/Import or calibrate some data first/)).toBeInTheDocument();
    // With nothing listed, nothing may claim "the files checked above".
    expect(screen.queryByText(/files checked above/)).not.toBeInTheDocument();
  });

  it('a failed library load reads as a failure, not as an empty library', async () => {
    vi.mocked(getAll).mockRejectedValue(new Error('network down'));
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/calibrate/seed-nircam-imaging',
            state: { inputDataIds: ['a'], stage3Only: true },
          },
        ]}
      >
        <Routes>
          <Route path="/calibrate/:recipeId" element={<CalibrateRun />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    expect(screen.queryByText(/No matching library files/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run calibration' })).toBeDisabled();
  });
});
