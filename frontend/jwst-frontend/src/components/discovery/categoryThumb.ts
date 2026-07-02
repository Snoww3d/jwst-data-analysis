import './categoryGradients.css';

/**
 * CSS class for a target category's vivid gradient thumbnail (design handoff
 * palette). Used wherever a target has no real observation thumbnail.
 */
export function categoryThumbClass(category: string): string {
  const slug = category.toLowerCase().replace(/\s+/g, '-');
  const known = new Set(['nebula', 'galaxy', 'planetary', 'star-cluster', 'cluster', 'exoplanet']);
  return `category-thumb-${known.has(slug) ? slug : 'default'}`;
}
