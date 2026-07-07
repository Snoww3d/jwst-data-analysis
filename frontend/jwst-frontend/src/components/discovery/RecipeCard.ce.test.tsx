import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecipeCard } from './RecipeCard';
import type { CompositeRecipe } from '../../types/DiscoveryTypes';

// CE: anonymous forever — a recipe whose data isn't seeded must read
// "Not in library", never "Login required"
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../../context/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('../../services/jwstDataService', () => ({
  checkDataAvailability: vi.fn().mockResolvedValue({ results: {} }),
}));

const recipe: CompositeRecipe = {
  name: 'Classic RGB',
  rank: 1,
  filters: ['F770W', 'F1130W', 'F1800W'],
  colorMapping: { F770W: '#0000ff', F1130W: '#00ff00', F1800W: '#ff0000' },
  instruments: ['MIRI'],
  requiresMosaic: false,
  estimatedTimeSeconds: 30,
  observationIds: ['o1'],
  description: 'test',
};

describe('RecipeCard in CE mode', () => {
  it('shows "Not in library" instead of "Login required" when data is unavailable', async () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={recipe} targetName="NGC 3132" observations={[]} />
      </MemoryRouter>
    );
    expect(await screen.findByText('Not in library')).toBeInTheDocument();
    expect(screen.queryByText('Login required')).not.toBeInTheDocument();
  });
});
