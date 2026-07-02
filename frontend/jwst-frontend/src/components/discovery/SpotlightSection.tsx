import { Link } from 'react-router-dom';
import type { FeaturedTarget } from '../../types/DiscoveryTypes';
import { InstrumentBadge } from './InstrumentBadge';
import { categoryThumbClass } from './categoryThumb';
import { deriveSpotlight } from '../../utils/spotlight';
import { SparklesIcon, ArrowRightIcon } from '../icons/DashboardIcons';
import spotlightImage from '../../assets/jwst-background.png';
import './SpotlightSection.css';

interface SpotlightSectionProps {
  targets: FeaturedTarget[];
}

function targetPath(target: FeaturedTarget): string {
  const slug = encodeURIComponent(target.mastSearchParams.target);
  const radiusParam = target.mastSearchParams.searchRadius
    ? `?radius=${target.mastSearchParams.searchRadius}`
    : '';
  return `/target/${slug}${radiusParam}`;
}

/**
 * "Target of the week" spotlight: one cinematic hero card plus up to two
 * mini-feature cards. Curation is client-derived until #1614 lands.
 */
export function SpotlightSection({ targets }: SpotlightSectionProps) {
  const { hero, minis } = deriveSpotlight(targets);
  if (!hero) return null;

  return (
    <section className="spotlight" aria-label="Target of the week">
      <Link
        to={targetPath(hero)}
        className="spotlight-hero"
        aria-label={`Target of the week: ${hero.name}`}
      >
        <img
          src={hero.thumbnail ?? spotlightImage}
          alt=""
          className="spotlight-hero-image"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            // Fall back to the bundled mosaic once; guard against a retry loop
            if (!img.src.endsWith(spotlightImage)) {
              img.src = spotlightImage;
            }
          }}
        />
        <div className="spotlight-hero-scrim" aria-hidden="true" />
        <div className="spotlight-hero-content">
          <span className="spotlight-eyebrow">
            <SparklesIcon size={13} />
            Target of the week
          </span>
          <h2 className="spotlight-title">{hero.name}</h2>
          {hero.catalogId && <p className="spotlight-catalog">{hero.catalogId}</p>}
          <p className="spotlight-blurb">{hero.description}</p>
          <div className="spotlight-meta">
            {hero.instruments.map((instrument) => (
              <InstrumentBadge key={instrument} instrument={instrument} large />
            ))}
            {hero.filterCount > 0 && (
              <span className="spotlight-meta-text">
                <span className="spotlight-meta-dot">&middot;</span>
                {hero.filterCount} filters
              </span>
            )}
          </div>
          {/* Single CTA until #1614: a "Quick composite" deep link needs a resolved recipe */}
          <div className="spotlight-ctas">
            <span className="btn-base spotlight-cta-primary">
              Open target
              <ArrowRightIcon size={17} />
            </span>
          </div>
        </div>
      </Link>

      {minis.length > 0 && (
        <div className="spotlight-minis">
          {minis.map((target) => (
            <Link
              key={target.name}
              to={targetPath(target)}
              className={`spotlight-mini ${categoryThumbClass(target.category)}`}
            >
              {target.thumbnail && (
                <img
                  src={target.thumbnail}
                  alt=""
                  className="spotlight-mini-image"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="spotlight-mini-scrim" aria-hidden="true" />
              <div className="spotlight-mini-content">
                {target.catalogId && <p className="spotlight-mini-tag">{target.catalogId}</p>}
                <h3 className="spotlight-mini-name">{target.name}</h3>
                <p className="spotlight-mini-meta">
                  <span className="spotlight-mini-category">{target.category}</span>
                  {target.filterCount > 0 && <> &middot; {target.filterCount} filters</>}
                </p>
              </div>
              <ArrowRightIcon size={18} className="spotlight-mini-arrow" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
