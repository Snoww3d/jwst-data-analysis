import type { FeaturedTarget } from '../../types/DiscoveryTypes';
import { POTENTIAL_CONFIG } from './potentialConfig';
import './PotentialPill.css';

interface PotentialPillProps {
  potential: FeaturedTarget['compositePotential'];
}

/** Composite-potential pill shown on target cards. */
export function PotentialPill({ potential }: PotentialPillProps) {
  const config = POTENTIAL_CONFIG[potential] ?? POTENTIAL_CONFIG.good;
  return <span className={`potential-pill ${config.className}`}>{config.label}</span>;
}
