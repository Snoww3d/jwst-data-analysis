/**
 * Data-first entry flow (#1738).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CalibrateNew from './CalibrateNew';

vi.mock('../services/calibrationService', () => ({ listRecipes: vi.fn() }));
vi.mock('../services/jwstDataService', () => ({ getAll: vi.fn() }));

import { listRecipes } from '../services/calibrationService';
import { getAll } from '../services/jwstDataService';

const nircamFile = {
  id: 'a',
  fileName: 'jw02733_nircam_cal.fits',
  filePath: 'mast/jw02733/a_cal.fits',
  fileSize: 1024 ** 2,
  metadata: {
    mast_target_name: 'NGC 3132',
    mast_filters: 'F090W',
    mast_instrument_name: 'NIRCAM/IMAGE',
  },
};

const recipes = [
  { id: 'nircam-imaging', name: 'NIRCam Imaging', instrument: 'nircam', description: 'n' },
  { id: 'miri-imaging', name: 'MIRI Imaging', instrument: 'miri', description: 'm' },
];

/** Renders the router state rather than assigning to an outer variable during
 *  render, so the hand-off is asserted through the DOM. */
function ConfigStub() {
  const state = useLocation().state as unknown;
  return <div data-testid="config-stub">{JSON.stringify(state)}</div>;
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/calibrate/new']}>
      <Routes>
        <Route path="/calibrate/new" element={<CalibrateNew />} />
        <Route path="/calibrate/:recipeId" element={<ConfigStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CalibrateNew', () => {
  beforeEach(() => {
    vi.mocked(getAll).mockResolvedValue([nircamFile] as never);
    vi.mocked(listRecipes).mockResolvedValue(recipes as never);
  });

  it('leads with data, grouped by target rather than listing raw paths', async () => {
    renderNew();
    expect(await screen.findByText('NGC 3132')).toBeInTheDocument();
    expect(screen.getByText('F090W')).toBeInTheDocument();
    // Can't advance until data is chosen — the flow is data-first by construction.
    expect(screen.getByRole('button', { name: /Choose recipe/ })).toBeDisabled();
  });

  it('offers only instrument-matched recipes, then hands off with the inputs', async () => {
    renderNew();
    await screen.findByText('NGC 3132');

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all in NGC 3132/ }));
    await userEvent.click(screen.getByRole('button', { name: /Choose recipe/ }));

    // NIRCam data: the MIRI recipe is shown but not selectable.
    const buttons = await screen.findAllByRole('button', { name: /Review & run/ });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();

    await userEvent.click(buttons[0]);
    // The chosen files travel to the review step.
    const stub = await screen.findByTestId('config-stub');
    expect(JSON.parse(stub.textContent || '{}')).toEqual({
      inputs: ['mast/jw02733/a_cal.fits'],
    });
  });

  it('filters the library by search', async () => {
    renderNew();
    await screen.findByText('NGC 3132');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search library' }), 'nothing');
    await waitFor(() => expect(screen.queryByText('NGC 3132')).not.toBeInTheDocument());
  });

  it('explains the empty library instead of showing a bare list', async () => {
    vi.mocked(getAll).mockResolvedValue([] as never);
    renderNew();
    expect(await screen.findByText('Nothing to calibrate yet')).toBeInTheDocument();
  });
});
