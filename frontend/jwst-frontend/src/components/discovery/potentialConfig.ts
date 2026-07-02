import type { FeaturedTarget } from '../../types/DiscoveryTypes';

export const POTENTIAL_CONFIG = {
  great: { className: 'potential-great', label: 'Great potential' },
  good: { className: 'potential-good', label: 'Good potential' },
  limited: { className: 'potential-limited', label: 'Limited data' },
} as const;

/** Accessible label text for a target's composite potential. */
export function potentialLabel(potential: FeaturedTarget['compositePotential']): string {
  return (POTENTIAL_CONFIG[potential] ?? POTENTIAL_CONFIG.good).label;
}
