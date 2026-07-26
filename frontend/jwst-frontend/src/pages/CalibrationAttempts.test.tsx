import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CalibrationAttempts from './CalibrationAttempts';
import type { JwstDataModel } from '../types/JwstDataTypes';

vi.mock('../services/jwstDataService', () => ({ getAll: vi.fn() }));
const mockAuth = { isAuthenticated: true };
vi.mock('../context/useAuth', () => ({ useAuth: () => mockAuth }));
vi.mock('../config/api', () => ({ API_BASE_URL: 'http://test:5001' }));

import { getAll } from '../services/jwstDataService';

const output = (over: Partial<JwstDataModel>): JwstDataModel =>
  ({
    id: 'x',
    fileName: 'nircam-imaging_i2d.fits',
    observationBaseId: 'jw02733001001',
    uploadDate: '2026-07-01T00:00:00Z',
    tags: ['calibration'],
    metadata: { source: 'calibration', mast_instrument_name: 'NIRCAM/IMAGE' },
    processingLevel: 'L2b',
    ...over,
  }) as JwstDataModel;

function renderPage(extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/calibrate/attempts']}>
      <Routes>
        <Route path="/calibrate/attempts" element={<CalibrationAttempts />} />
        {extra}
      </Routes>
    </MemoryRouter>
  );
}

describe('CalibrationAttempts', () => {
  beforeEach(() => {
    mockAuth.isAuthenticated = true;
    vi.mocked(getAll).mockResolvedValue([] as never);
  });

  it('says when a run predates settings being recorded', async () => {
    vi.mocked(getAll).mockResolvedValue([
      output({ id: 'a', metadata: { source: 'calibration' } }),
      output({ id: 'b', metadata: { source: 'calibration' } }),
    ] as never);
    renderPage();
    expect(await screen.findAllByText('Settings not recorded')).toHaveLength(2);
  });

  it('shows the differing setting, which is why they are side by side', async () => {
    vi.mocked(getAll).mockResolvedValue([
      output({
        id: 'a',
        metadata: { source: 'calibration', run_overrides: { tweakreg: { snr_threshold: 5 } } },
      }),
      output({
        id: 'b',
        metadata: { source: 'calibration', run_overrides: { tweakreg: { snr_threshold: 10 } } },
      }),
    ] as never);
    renderPage();
    expect(
      await screen.findByText(/Differing settings: tweakreg.snr_threshold/)
    ).toBeInTheDocument();
    expect(screen.getByText('snr_threshold = 5')).toBeInTheDocument();
    expect(screen.getByText('snr_threshold = 10')).toBeInTheDocument();
  });

  it('does not list a lone run — one attempt is not a comparison', async () => {
    vi.mocked(getAll).mockResolvedValue([output({ id: 'only' })] as never);
    renderPage();
    expect(await screen.findByText(/Nothing to compare yet/)).toBeInTheDocument();
  });

  it('carries a chosen attempt into the next level', async () => {
    let handedOff: unknown = null;
    function Stub() {
      handedOff = useLocation().state;
      return <div>run config stub</div>;
    }
    vi.mocked(getAll).mockResolvedValue([
      output({ id: 'a', uploadDate: '2026-07-02T00:00:00Z' }),
      output({ id: 'b', uploadDate: '2026-07-01T00:00:00Z' }),
    ] as never);
    renderPage(<Route path="/calibrate/:recipeId" element={<Stub />} />);

    const buttons = await screen.findAllByRole('button', { name: 'Combine to L3' });
    await userEvent.click(buttons[0]);

    await screen.findByText('run config stub');
    // Both siblings of the observation go in, not just the clicked one: a
    // mosaic built from one member is a single-frame drizzle (#1756).
    expect(handedOff).toEqual({
      inputDataIds: ['a', 'b'],
      startLevel: 'L2b',
      targetLevel: 'L3',
    });
  });

  it('marks a finished attempt as final instead of offering a dead control', async () => {
    vi.mocked(getAll).mockResolvedValue([
      output({ id: 'a', processingLevel: 'L3' }),
      output({ id: 'b', processingLevel: 'L3' }),
    ] as never);
    renderPage();
    expect(await screen.findAllByText('Final')).toHaveLength(2);
  });

  it('tells a signed-out visitor why it is empty', async () => {
    mockAuth.isAuthenticated = false;
    renderPage();
    expect(await screen.findByText(/Sign in to see your attempts/)).toBeInTheDocument();
  });

  it('reports a load failure rather than claiming there is nothing', async () => {
    vi.mocked(getAll).mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });

  it('newest attempt first — that is the one you are reasoning about', async () => {
    vi.mocked(getAll).mockResolvedValue([
      output({ id: 'old', uploadDate: '2026-07-01T00:00:00Z' }),
      output({ id: 'new', uploadDate: '2026-07-20T00:00:00Z' }),
    ] as never);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const images = screen.getAllByRole('img');
    expect(images[0]).toHaveAttribute('src', expect.stringContaining('/new/'));
  });
});
