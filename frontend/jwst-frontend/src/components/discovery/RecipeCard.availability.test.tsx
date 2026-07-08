import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecipeCard } from './RecipeCard';
import { checkDataAvailability } from '../../services/jwstDataService';
import type { CompositeRecipe } from '../../types/DiscoveryTypes';
import type { MastObservationResult } from '../../types/MastTypes';

vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../../context/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('../../services/jwstDataService', () => ({
  checkDataAvailability: vi.fn().mockResolvedValue({ results: {} }),
}));

const recipe: CompositeRecipe = {
  name: 'Classic RGB',
  rank: 1,
  filters: ['F770W'],
  colorMapping: { F770W: '#0000ff' },
  instruments: ['MIRI'],
  requiresMosaic: false,
  estimatedTimeSeconds: 30,
  observationIds: ['o1'],
  description: 'test',
};

const observations = [
  { obs_id: 'o1', filters: 'F770W', instrument_name: 'MIRI', dataproduct_type: 'image' },
] as MastObservationResult[];

function renderCard(availability?: 'ready' | 'missing' | 'pending') {
  return render(
    <MemoryRouter>
      <RecipeCard
        recipe={recipe}
        targetName="Crab Nebula"
        observations={observations}
        availability={availability}
      />
    </MemoryRouter>
  );
}

describe('RecipeCard availability prop (parent-controlled mode)', () => {
  beforeEach(() => {
    vi.mocked(checkDataAvailability).mockClear();
  });

  it('availability="ready" shows Ready and fires NO availability fetch', () => {
    renderCard('ready');
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(checkDataAvailability).not.toHaveBeenCalled();
  });

  it('availability="missing" shows the pill and fires NO availability fetch', () => {
    renderCard('missing');
    expect(screen.getByText('Not in library')).toBeInTheDocument();
    expect(checkDataAvailability).not.toHaveBeenCalled();
  });

  it('availability="pending" suppresses the status pill entirely', () => {
    renderCard('pending');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Not in library')).not.toBeInTheDocument();
    expect(checkDataAvailability).not.toHaveBeenCalled();
  });

  it('prop absent keeps the standalone self-check behavior (regression)', async () => {
    renderCard(undefined);
    // self-check fires and, with empty results, resolves to Not in library
    expect(await screen.findByText('Not in library')).toBeInTheDocument();
    expect(checkDataAvailability).toHaveBeenCalledTimes(1);
  });
});
