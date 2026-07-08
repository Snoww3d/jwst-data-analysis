import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { TargetDetail } from './TargetDetail';
import { checkDataAvailability } from '../services/jwstDataService';
import { searchByTarget } from '../services/mastService';
import { suggestRecipes } from '../services/discoveryService';
import type { CompositeRecipe } from '../types/DiscoveryTypes';

vi.mock('../config/ce', () => ({ CE_MODE: true }));
const authState = { isAuthenticated: false };
vi.mock('../context/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../services/mastService', () => ({ searchByTarget: vi.fn() }));
vi.mock('../services/discoveryService', () => ({ suggestRecipes: vi.fn() }));
vi.mock('../services/jwstDataService', () => ({ checkDataAvailability: vi.fn() }));

function makeRecipe(name: string, filters: string[]): CompositeRecipe {
  return {
    name,
    rank: 1,
    filters,
    colorMapping: {},
    instruments: ['MIRI'],
    requiresMosaic: false,
    estimatedTimeSeconds: 30,
    observationIds: filters.map((f) => `obs-${f.toLowerCase()}`),
    description: '',
  };
}

const observations = [
  { obs_id: 'obs-f770w', filters: 'F770W', instrument_name: 'MIRI', dataproduct_type: 'image' },
  { obs_id: 'obs-f090w', filters: 'F090W', instrument_name: 'NIRCAM', dataproduct_type: 'image' },
];

function mockHappyPath(availability: Record<string, unknown> | Error) {
  vi.mocked(searchByTarget).mockResolvedValue({ results: observations } as never);
  vi.mocked(suggestRecipes).mockResolvedValue({
    recipes: [makeRecipe('MIRI recipe', ['F770W']), makeRecipe('NIRCam recipe', ['F090W'])],
  } as never);
  if (availability instanceof Error) {
    vi.mocked(checkDataAvailability).mockRejectedValue(availability);
  } else {
    vi.mocked(checkDataAvailability).mockResolvedValue({ results: availability } as never);
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/target/Crab%20Nebula']}>
      <Routes>
        <Route path="/target/:name" element={<TargetDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TargetDetail recipe grouping', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): mockImplementation set inside a
    // test — e.g. the never-resolving availability promise — must not leak
    vi.resetAllMocks();
    authState.isAuthenticated = false;
  });

  it('authenticated users keep the flat layout and no page-level availability call (regression)', async () => {
    authState.isAuthenticated = true;
    mockHappyPath({});
    renderPage();
    await screen.findByText('Suggested Composites');
    expect(screen.queryByText('Ready to render')).not.toBeInTheDocument();
    expect(screen.queryByText('Not in library', { selector: 'h3' })).not.toBeInTheDocument();
    // page-level batched call is anonymous-only; cards self-check as before
    expect(checkDataAvailability).toHaveBeenCalledTimes(2);
  });

  it('mixed availability renders Ready section first, then Not in library', async () => {
    mockHappyPath({
      'obs-f770w': { available: true, dataIds: ['a'.repeat(24)], filter: 'F770W' },
    });
    renderPage();
    const ready = await screen.findByText('Ready to render');
    const missing = await screen.findByText('Not in library', { selector: 'h3' });
    // Ready section comes first in document order
    // DOCUMENT_POSITION_FOLLOWING === 4 (Node global is not in the lint env)
    expect(ready.compareDocumentPosition(missing) & 4).toBeTruthy();
    // the recommended badge belongs to the first READY recipe
    const readySection = ready.closest('section');
    expect(readySection?.textContent).toContain('MIRI recipe');
    expect(readySection?.textContent).toContain('Recommended');
  });

  it('all recipes ready renders a single section without an empty "Not in library" header', async () => {
    mockHappyPath({
      'obs-f770w': { available: true, dataIds: ['a'.repeat(24)], filter: 'F770W' },
      'obs-f090w': { available: true, dataIds: ['b'.repeat(24)], filter: 'F090W' },
    });
    renderPage();
    await screen.findByText('Ready to render');
    expect(screen.queryByText('Not in library', { selector: 'h3' })).not.toBeInTheDocument();
  });

  it('no recipes ready renders only the Not in library section header', async () => {
    mockHappyPath({});
    renderPage();
    await screen.findByText('Not in library', { selector: 'h3' });
    expect(screen.queryByText('Ready to render')).not.toBeInTheDocument();
  });

  it('availability failure degrades to the flat ungrouped list with no pills', async () => {
    mockHappyPath(new Error('availability down'));
    renderPage();
    // flat header, both recipes rendered, no grouping headers, no status pills
    await screen.findByText('Suggested Composites');
    expect(screen.getByText('MIRI recipe')).toBeInTheDocument();
    expect(screen.getByText('NIRCam recipe')).toBeInTheDocument();
    expect(screen.queryByText('Ready to render')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Not in library')).not.toBeInTheDocument();
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    });
  });

  it('navigating to a new target never groups with the previous target map (regression)', async () => {
    // Target A resolves: its recipe (shared name!) is READY.
    mockHappyPath({
      'obs-f770w': { available: true, dataIds: ['a'.repeat(24)], filter: 'F770W' },
      'obs-f090w': { available: true, dataIds: ['b'.repeat(24)], filter: 'F090W' },
    });
    render(
      <MemoryRouter initialEntries={['/target/Target%20A']}>
        <Link to="/target/Target%20B">go-to-b</Link>
        <Routes>
          <Route path="/target/:name" element={<TargetDetail />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText('Ready to render');

    // Target B: same recipe names, but availability never resolves.
    vi.mocked(checkDataAvailability).mockImplementation(() => new Promise(() => {}));
    screen.getByText('go-to-b').click();
    await screen.findByText('Suggested Composites');
    // B must be flat/pending — never "Ready to render" borrowed from A's map
    expect(screen.queryByText('Ready to render')).not.toBeInTheDocument();
  });

  it('makes exactly one chunked availability pass for the whole page (not per card)', async () => {
    mockHappyPath({
      'obs-f770w': { available: true, dataIds: ['a'.repeat(24)], filter: 'F770W' },
    });
    renderPage();
    await screen.findByText('Ready to render');
    expect(checkDataAvailability).toHaveBeenCalledTimes(1);
    const calledIds = vi.mocked(checkDataAvailability).mock.calls[0][0];
    expect([...calledIds].sort()).toEqual(['obs-f090w', 'obs-f770w']);
  });
});
