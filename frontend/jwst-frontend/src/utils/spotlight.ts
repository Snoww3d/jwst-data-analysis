import type { FeaturedTarget } from '../types/DiscoveryTypes';

/**
 * Select the spotlight hero (first great-potential target, else the first
 * target) and up to two mini-features from the remaining list.
 * Client-derived curation until #1614 lands.
 */
export function deriveSpotlight(targets: FeaturedTarget[]): {
  hero: FeaturedTarget | null;
  minis: FeaturedTarget[];
} {
  if (targets.length === 0) return { hero: null, minis: [] };
  const hero = targets.find((t) => t.compositePotential === 'great') ?? targets[0];
  const minis = targets.filter((t) => t !== hero).slice(0, 2);
  return { hero, minis };
}
