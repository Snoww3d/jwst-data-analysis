import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SpotlightSection } from './SpotlightSection';
import { deriveSpotlight } from '../../utils/spotlight';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';

function makeTarget(overrides: Partial<FeaturedTarget>): FeaturedTarget {
  return {
    name: 'Carina Nebula',
    catalogId: 'NGC 3372',
    category: 'nebula',
    description: 'A star-forming region',
    instruments: ['NIRCam', 'MIRI'],
    filterCount: 6,
    compositePotential: 'great',
    mastSearchParams: { target: 'Carina Nebula' },
    ...overrides,
  };
}

const targets: FeaturedTarget[] = [
  makeTarget({ name: 'Phantom Galaxy', category: 'galaxy', compositePotential: 'good' }),
  makeTarget({}),
  makeTarget({ name: 'Southern Ring', category: 'planetary', compositePotential: 'limited' }),
  makeTarget({ name: 'Westerlund 2', category: 'star cluster', compositePotential: 'good' }),
];

describe('deriveSpotlight', () => {
  it('picks the first great-potential target as hero', () => {
    const { hero, minis } = deriveSpotlight(targets);
    expect(hero?.name).toBe('Carina Nebula');
    expect(minis.map((t) => t.name)).toEqual(['Phantom Galaxy', 'Southern Ring']);
  });

  it('falls back to the first target when nothing is great', () => {
    const noGreat = targets.filter((t) => t.compositePotential !== 'great');
    const { hero } = deriveSpotlight(noGreat);
    expect(hero?.name).toBe('Phantom Galaxy');
  });

  it('handles fewer than three targets', () => {
    const { hero, minis } = deriveSpotlight([targets[1]]);
    expect(hero?.name).toBe('Carina Nebula');
    expect(minis).toHaveLength(0);
  });

  it('returns null hero for an empty list', () => {
    expect(deriveSpotlight([]).hero).toBeNull();
  });
});

describe('SpotlightSection', () => {
  it('renders hero with eyebrow, instruments, and CTAs', () => {
    render(
      <MemoryRouter>
        <SpotlightSection targets={targets} />
      </MemoryRouter>
    );
    expect(screen.getByText('Target of the week')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Carina Nebula' })).toBeInTheDocument();
    expect(screen.getAllByText('NIRCam').length).toBeGreaterThan(0);
    expect(screen.getByText('Open target')).toBeInTheDocument();
  });

  it('labels the hero link for screen readers', () => {
    render(
      <MemoryRouter>
        <SpotlightSection targets={targets} />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('link', { name: 'Target of the week: Carina Nebula' })
    ).toBeInTheDocument();
  });

  it('uses the target thumbnail for the hero when present', () => {
    const withThumb = [{ ...targets[1], thumbnail: 'https://example.com/carina.jpg' }];
    render(
      <MemoryRouter>
        <SpotlightSection targets={withThumb} />
      </MemoryRouter>
    );
    const img = document.querySelector('.spotlight-hero-image') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/carina.jpg');
  });

  it('links hero and minis to their target detail pages', () => {
    render(
      <MemoryRouter>
        <SpotlightSection targets={targets} />
      </MemoryRouter>
    );
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/target/Carina%20Nebula');
    expect(links).toHaveLength(3);
  });

  it('renders nothing with no targets', () => {
    const { container } = render(
      <MemoryRouter>
        <SpotlightSection targets={[]} />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });
});
