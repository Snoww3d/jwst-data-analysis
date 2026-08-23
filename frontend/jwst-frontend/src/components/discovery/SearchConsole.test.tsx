import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchConsole } from './SearchConsole';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';

const featured: FeaturedTarget[] = [
  {
    name: 'Carina Nebula',
    catalogId: 'NGC 3324',
    category: 'nebula',
    description: '',
    instruments: ['NIRCam'],
    filterCount: 6,
    compositePotential: 'great',
    mastSearchParams: { target: 'NGC 3324', searchRadius: 0.1 },
  },
  {
    name: 'Eagle Nebula',
    catalogId: 'M16',
    category: 'nebula',
    description: '',
    instruments: ['NIRCam'],
    filterCount: 4,
    compositePotential: 'good',
    mastSearchParams: { target: 'M16' },
  },
  {
    name: 'Westerlund 2',
    category: 'cluster',
    description: '',
    instruments: ['NIRCam'],
    filterCount: 4,
    compositePotential: 'good',
    mastSearchParams: { target: 'Westerlund 2' },
  },
];

function ShowLocation() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderConsole(query = '', onQueryChange = vi.fn(), targets = featured) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<SearchConsole query={query} onQueryChange={onQueryChange} targets={targets} />}
        />
        <Route path="/target/:name" element={<ShowLocation />} />
        <Route path="/search" element={<ShowLocation />} />
      </Routes>
    </MemoryRouter>
  );
  return onQueryChange;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }));

describe('SearchConsole', () => {
  it('renders headline, input, and example chips', () => {
    renderConsole();
    expect(
      screen.getByRole('heading', { name: /explore the universe through webb/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PID 2739' })).toBeInTheDocument();
  });

  it('propagates typing to onQueryChange', () => {
    const onQueryChange = renderConsole();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'M16' } });
    expect(onQueryChange).toHaveBeenCalledWith('M16');
  });

  it('populates the query when an example chip is clicked', () => {
    const onQueryChange = renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'NGC 3324' }));
    expect(onQueryChange).toHaveBeenCalledWith('NGC 3324');
  });

  it('disables the search button for queries under 2 characters', () => {
    renderConsole('M');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  describe('submit routing (MAST Search v2, Phase 2)', () => {
    it('a featured target name opens its detail page, same link as the card', () => {
      renderConsole('Carina Nebula');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/target/NGC%203324?radius=0.1');
    });

    it('a featured catalog ID (chip M16) opens its detail page', () => {
      renderConsole('M16');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/target/M16');
    });

    it('chip NGC 3324 opens the Carina detail page', () => {
      renderConsole('NGC 3324');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/target/NGC%203324?radius=0.1');
    });

    it('matching is case-insensitive and tolerates a unique partial', () => {
      renderConsole('westerlund');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/target/Westerlund%202');
    });

    it('chip 10h 37m -58° goes to MAST search with the raw text and default radius', () => {
      renderConsole('10h 37m -58°');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/search?q=10h+37m+-58%C2%B0&r=0.2');
    });

    it('chip PID 2739 goes to MAST search', () => {
      renderConsole('PID 2739');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/search?q=PID+2739&r=0.2');
    });

    it('an unknown name goes to MAST search rather than a dead target page', () => {
      renderConsole('NGC 7496');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/search?q=NGC+7496&r=0.2');
    });

    it('an ambiguous partial ("nebula" matches two cards) goes to MAST search', () => {
      renderConsole('nebula');
      submit();
      expect(screen.getByTestId('location')).toHaveTextContent('/search?q=nebula&r=0.2');
    });
  });
});
