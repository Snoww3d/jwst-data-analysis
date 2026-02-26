import './DiscoveryHome.css';

/**
 * Discovery home page — featured targets + search.
 * Placeholder shell — content implemented in Phase C (task #7).
 */
export function DiscoveryHome() {
  return (
    <div className="discovery-home">
      <div className="discovery-hero">
        <h2>Discover JWST Targets</h2>
        <p>Browse featured targets and create stunning composite images</p>
        <div className="discovery-search-placeholder">
          <input
            type="text"
            placeholder="Search targets (e.g., Carina Nebula, M31, NGC 346...)"
            disabled
            className="discovery-search-input"
          />
        </div>
      </div>

      <section className="discovery-section">
        <h3>Featured Targets</h3>
        <p className="section-placeholder">
          Featured targets will appear here once the backend API and full page are implemented.
        </p>
      </section>
    </div>
  );
}
