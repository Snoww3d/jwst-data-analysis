import { Link } from 'react-router-dom';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';
import { TelescopeIcon } from '../icons/DashboardIcons';
import './TargetCard.css';

interface TargetCardProps {
  target: FeaturedTarget;
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  nebula: 'linear-gradient(135deg, #1a0a2e, #2d1b4e)',
  galaxy: 'linear-gradient(135deg, #0a1628, #1a2d4e)',
  'star cluster': 'linear-gradient(135deg, #1a1a0a, #2e2d1b)',
};

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #0d1117, #1a1d24)';

const POTENTIAL_CONFIG = {
  great: {
    className: 'potential-great',
    label: 'Great for composites',
  },
  good: {
    className: 'potential-good',
    label: 'Good for composites',
  },
  limited: {
    className: 'potential-limited',
    label: 'Limited data',
  },
} as const;

/**
 * Card for a featured JWST target. Entire card is a link to the target detail page.
 */
export function TargetCard({ target }: TargetCardProps) {
  const slug = encodeURIComponent(target.name);
  const instrumentsText = target.instruments.join(' + ');
  const potential = POTENTIAL_CONFIG[target.compositePotential];
  const gradient = CATEGORY_GRADIENTS[target.category.toLowerCase()] ?? DEFAULT_GRADIENT;

  const ariaLabel = [
    target.name,
    target.catalogId,
    instrumentsText,
    `${target.filterCount} filters`,
    potential.label,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Link to={`/target/${slug}`} className="target-card" aria-label={ariaLabel}>
      <div className="target-card-thumbnail" style={{ background: gradient }}>
        {target.thumbnail ? (
          <img
            src={target.thumbnail}
            alt=""
            className="target-card-image"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="target-card-placeholder-icon">
            <TelescopeIcon size={40} />
          </div>
        )}
      </div>
      <div className="target-card-body">
        <h3 className="target-card-name">{target.name}</h3>
        {target.catalogId && <p className="target-card-catalog">{target.catalogId}</p>}
        <p className="target-card-info">
          <span>{instrumentsText}</span>
          <span className="target-card-dot">&middot;</span>
          <span>{target.filterCount} filters</span>
        </p>
        <span className={`target-card-potential ${potential.className}`}>{potential.label}</span>
      </div>
    </Link>
  );
}
