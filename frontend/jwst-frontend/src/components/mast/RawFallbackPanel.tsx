import React from 'react';
import type { RawFallbackOffer } from './rawFallback';

interface RawFallbackPanelProps {
  offer: RawFallbackOffer | null;
  loading: boolean;
  onAccept: () => void;
}

/**
 * The raw-data fallback offer (#1760), inside a live region that is ALWAYS
 * mounted and only changes contents: several screen readers announce nothing
 * when the region itself is inserted, and on the empty-L3 path this is the
 * only signal that the search succeeded but found almost nothing.
 */
const RawFallbackPanel: React.FC<RawFallbackPanelProps> = ({ offer, loading, onAccept }) => (
  <div role="status" aria-live="polite">
    {offer && (
      <div className="raw-fallback">
        <div>
          <h3 className="raw-fallback-headline">{offer.headline}</h3>
          <p className="raw-fallback-detail">{offer.detail}</p>
        </div>
        <button
          type="button"
          className="btn-base btn-compact"
          onClick={onAccept}
          disabled={loading}
        >
          Search including raw data
        </button>
      </div>
    )}
  </div>
);

export default RawFallbackPanel;
