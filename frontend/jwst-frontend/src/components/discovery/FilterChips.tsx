import type { TargetFilter } from '../../utils/filterTargets';
import './FilterChips.css';

interface FilterChipsProps {
  /** Lowercased categories present in the fetched data (see categoriesOf). */
  categories: string[];
  active: TargetFilter;
  onChange: (filter: TargetFilter) => void;
}

/** Display labels for known backend categories; anything else is title-cased as-is. */
const CATEGORY_LABELS: Record<string, string> = {
  nebula: 'Nebulae',
  galaxy: 'Galaxies',
  planetary: 'Planetary',
  'star cluster': 'Star clusters',
  cluster: 'Star clusters',
  exoplanet: 'Exoplanets',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Filter chip row for the featured-target grid. Category chips are derived
 * from the data so a chip can never be a dead filter.
 */
export function FilterChips({ categories, active, onChange }: FilterChipsProps) {
  const chips: { value: TargetFilter; label: string }[] = [
    { value: 'all', label: 'All targets' },
    { value: 'great', label: 'Best potential' },
    ...categories.map((category) => ({ value: category, label: categoryLabel(category) })),
  ];

  return (
    <div className="filter-chips" role="group" aria-label="Filter targets">
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          className={`filter-chip${active === chip.value ? ' filter-chip-active' : ''}`}
          aria-pressed={active === chip.value}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
