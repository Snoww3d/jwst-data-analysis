import { useState, useEffect } from 'react';
import { checkHealth } from '../../services/healthService';
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
    >
      <span className="mast-status-dot" aria-hidden="true" />
      MAST &middot; {online ? 'online' : 'offline'}
    </span>
  );
}
