import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CalibrationGallery, { CalibrationRecipeCard } from './CalibrationGallery';
import type { CalibrationRecipe } from '../types/CalibrationTypes';

vi.mock('../services/calibrationService', () => ({
  listRecipes: vi.fn(),
  getCapabilities: vi.fn(),
  importNotebook: vi.fn(),
}));

import userEvent from '@testing-library/user-event';
import { getCapabilities, importNotebook, listRecipes } from '../services/calibrationService';

const seedRecipe: CalibrationRecipe = {
  id: 'seed-miri-imaging',
  schema_version: 1,
  name: 'MIRI Imaging (uncal → i2d mosaic)',
  description: 'MIRI broadband imaging reduction.',
  instrument: 'miri',
  mode: 'imaging',
  source: 'seed',
  is_public: true,
  provenance: { notebook_name: 'JWPipeNB-MIRI-imaging.ipynb', jwst_version_authored: '2.0.0' },
  input_source: {
    type: 'mast_query',
    proposal_id: '1040',
    observation: '001',
    filters: ['F770W'],
    calib_level: 1,
    product_suffixes: ['_uncal'],
  },
  stages: [
    { name: 'detector1', enabled: true, step_overrides: { jump: { maximum_cores: 'half' } } },
    { name: 'image2', enabled: true, step_overrides: { bkg_subtract: { sigma: 2 } } },
    { name: 'image3', enabled: false, step_overrides: {} },
  ],
  association: { rule: 'DMS_Level3_Base', product_name: 'miri-imaging' },
  output_suffixes: ['_i2d'],
  created_by: null,
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
};

describe('CalibrationRecipeCard', () => {
  it('renders instrument, curated badge, enabled stages, and meta', () => {
    render(
      <MemoryRouter>
        <CalibrationRecipeCard recipe={seedRecipe} />
      </MemoryRouter>
    );
    expect(screen.getByText('MIRI')).toBeInTheDocument();
    expect(screen.getByText('Curated')).toBeInTheDocument();
    // Only enabled stages render as chips.
    expect(screen.getByText('detector1')).toBeInTheDocument();
    expect(screen.getByText('image2')).toBeInTheDocument();
    expect(screen.queryByText('image3')).not.toBeInTheDocument();
    expect(screen.getByText('MAST PID 1040')).toBeInTheDocument();
    expect(screen.getByText('2 tuned parameters')).toBeInTheDocument();
    expect(screen.getByText('STScI notebook')).toBeInTheDocument();
  });
});

describe('CalibrationGallery', () => {
  it('renders recipes and the pipeline version', async () => {
    vi.mocked(listRecipes).mockResolvedValue([seedRecipe]);
    vi.mocked(getCapabilities).mockResolvedValue({
      calibrationEnabled: true,
      jwstVersion: '2.0.1',
    });
    render(
      <MemoryRouter>
        <CalibrationGallery />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('calibration-recipe-card')).toBeInTheDocument());
    expect(screen.getByText(/Pipeline v2\.0\.1/)).toBeInTheDocument();
    expect(screen.queryByText(/runs are disabled on this deployment/)).not.toBeInTheDocument();
  });

  it('shows the disabled banner when calibration is off', async () => {
    vi.mocked(listRecipes).mockResolvedValue([seedRecipe]);
    vi.mocked(getCapabilities).mockResolvedValue({
      calibrationEnabled: false,
      jwstVersion: null,
    });
    render(
      <MemoryRouter>
        <CalibrationGallery />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText(/runs are disabled on this deployment/)).toBeInTheDocument()
    );
  });

  it('shows an error state when loading fails', async () => {
    vi.mocked(listRecipes).mockRejectedValue(new Error('engine unreachable'));
    vi.mocked(getCapabilities).mockResolvedValue({
      calibrationEnabled: true,
      jwstVersion: null,
    });
    render(
      <MemoryRouter>
        <CalibrationGallery />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText("Couldn't load calibration recipes")).toBeInTheDocument()
    );
    expect(screen.getByText('engine unreachable')).toBeInTheDocument();
  });
});

describe('CalibrationGallery import', () => {
  it('imports a notebook and prepends the recipe with warnings', async () => {
    vi.mocked(listRecipes).mockResolvedValue([seedRecipe]);
    vi.mocked(getCapabilities).mockResolvedValue({
      calibrationEnabled: true,
      jwstVersion: '2.0.1',
    });
    vi.mocked(importNotebook).mockResolvedValue({
      recipe: { ...seedRecipe, id: 'user-imported', name: 'Imported: x.ipynb', source: 'imported' },
      warnings: ['cell 7: custom code is not carried into the recipe'],
    });
    render(
      <MemoryRouter>
        <CalibrationGallery />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('calibration-recipe-card')).toBeInTheDocument());
    const file = new File(['{"cells":[]}'], 'x.ipynb', { type: 'application/json' });
    const input = screen.getByLabelText('Import a JWPipeNB notebook') as HTMLInputElement;
    await userEvent.upload(input, file);
    await waitFor(() => expect(screen.getByText('Imported: x.ipynb')).toBeInTheDocument());
    expect(screen.getByText(/custom code is not carried/)).toBeInTheDocument();
  });

  it('shows an import error', async () => {
    vi.mocked(listRecipes).mockResolvedValue([seedRecipe]);
    vi.mocked(getCapabilities).mockResolvedValue({
      calibrationEnabled: true,
      jwstVersion: '2.0.1',
    });
    vi.mocked(importNotebook).mockRejectedValue(new Error('not a recognizable JWPipeNB notebook'));
    render(
      <MemoryRouter>
        <CalibrationGallery />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('calibration-recipe-card')).toBeInTheDocument());
    const file = new File(['garbage'], 'bad.ipynb', { type: 'application/json' });
    await userEvent.upload(
      screen.getByLabelText('Import a JWPipeNB notebook') as HTMLInputElement,
      file
    );
    await waitFor(() =>
      expect(screen.getByText('not a recognizable JWPipeNB notebook')).toBeInTheDocument()
    );
  });
});
