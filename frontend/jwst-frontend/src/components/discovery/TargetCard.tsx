import { Link } from 'react-router-dom';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';
import { TelescopeIcon } from '../icons/DashboardIcons';
import { formatInstruments } from '../../utils/instrumentDisplay';
import { InstrumentBadge } from './InstrumentBadge';
import { PotentialPill } from './PotentialPill';
import { potentialLabel } from './potentialConfig';
import { categoryThumbClass } from './categoryThumb';
import './TargetCard.css';

interface TargetCardProps {
  target: FeaturedTarget;
}

/**
 * Card for a featured JWST target. Entire card is a link to the target detail page.
 */
export function TargetCard({ target }: TargetCardProps) {
  const slug = encodeURIComponent(target.mastSearchParams.target);
  const radiusParam = target.mastSearchParams.searchRadius
    ? `?radius=${target.mastSearchParams.searchRadius}`
    : '';
  const instrumentsText = formatInstruments(target.instruments);

  const ariaLabel = [
    target.name,
    target.catalogId,
    instrumentsText,
    target.filterCount ? `${target.filterCount} filters` : null,
    potentialLabel(target.compositePotential),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Link to={`/target/${slug}${radiusParam}`} className="target-card" aria-label={ariaLabel}>
      <div className={`target-card-thumbnail ${categoryThumbClass(target.category)}`}>
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
        {target.instruments.length > 0 && (
          <div className="target-card-badges">
            {target.instruments.map((instrument) => (
              <InstrumentBadge key={instrument} instrument={instrument} />
            ))}
          </div>
        )}
      </div>
      <div className="target-card-body">
        <h3 className="target-card-name">{target.name}</h3>
        {target.catalogId && <p className="target-card-catalog">{target.catalogId}</p>}
        <p className="target-card-info">
          <span className="target-card-category">{target.category}</span>
          <span className="target-card-dot">&middot;</span>
          <span>{instrumentsText}</span>
        </p>
        <div className="target-card-footer">
          <PotentialPill potential={target.compositePotential} />
          {target.filterCount > 0 && (
            <span className="target-card-filters">{target.filterCount} filters</span>
          )}
        </div>
      </div>
    </Link>
  );
}
