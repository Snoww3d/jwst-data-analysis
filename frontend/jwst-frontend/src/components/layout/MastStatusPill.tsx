import { useState, useEffect } from 'react';
import { checkHealth } from '../../services/healthService';
import { CE_MODE } from '../../config/ce';
import './MastStatusPill.css';

const POLL_INTERVAL_MS = 60_000;

/**
 * Header pill showing live backend/MAST connectivity from /api/health.
 * Renders nothing until the first check resolves to avoid a status flash.
 */
export function MastStatusPill() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const health = await checkHealth();
      if (!cancelled) {
        setOnline(health !== null && health.status.toLowerCase() === 'healthy');
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (online === null) return null;

  return (
    <span
      className={`mast-status-pill ${online ? 'mast-status-online' : 'mast-status-offline'}`}
      role="status"
      title={
        CE_MODE
          ? 'Live connection to the space telescope data archive (MAST, operated by STScI)'
          : "Live connection to MAST, the Space Telescope Science Institute's data archive"
      }
    >
      <span className="mast-status-dot" aria-hidden="true" />
      {CE_MODE ? 'Archive' : 'MAST'} &middot; {online ? 'online' : 'offline'}
    </span>
  );
}
