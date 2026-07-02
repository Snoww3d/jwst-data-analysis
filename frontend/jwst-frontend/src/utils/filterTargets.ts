import type { FeaturedTarget } from '../types/DiscoveryTypes';

/**
 * Active filter for the featured-target grid: 'all', 'great' (composite
 * potential), or a lowercased category name derived from the fetched data.
 */
export type TargetFilter = 'all' | 'great' | (string & {});

/**
 * Filter featured targets by chip selection AND search query.
 * The query matches case-insensitively against name, catalog id, and category.
 */
export function filterTargets(
  targets: FeaturedTarget[],
  filter: TargetFilter,
  query: string
): FeaturedTarget[] {
  const q = query.trim().toLowerCase();
  const f = filter.toLowerCase();

  return targets.filter((target) => {
    if (f === 'great' && target.compositePotential !== 'great') return false;
    if (f !== 'all' && f !== 'great' && target.category.toLowerCase() !== f) return false;
    if (!q) return true;

    const haystack = [target.name, target.catalogId ?? '', target.category].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

/** Unique lowercased categories present in the data, in first-seen order. */
export function categoriesOf(targets: FeaturedTarget[]): string[] {
  const seen = new Set<string>();
  for (const target of targets) {
    seen.add(target.category.toLowerCase());
  }
  return [...seen];
}
