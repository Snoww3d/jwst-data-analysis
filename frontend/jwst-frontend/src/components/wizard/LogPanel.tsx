import React, { useEffect, useRef, useState } from 'react';
import './LogPanel.css';

/**
 * Collapsible developer-detail log panel for long-running composite preview jobs (#1471).
 *
 * Collapsed by default behind a "Show details" disclosure so non-astronomer
 * users don't get blasted by RSS readouts and stage names; expanded view
 * shows a scrollable, monospace, timestamped buffer that auto-scrolls to
 * the bottom unless the user has scrolled up to read history.
 *
 * Messages come from `useJobProgress(jobId).messages` — a rolling buffer
 * capped at 50 entries, hydrated from `GET /api/jobs/{id}` on mount and
 * on SignalR reconnect, appended per progress event.
 */
interface LogPanelProps {
  messages: string[];
  /** Default collapsed state; defaults to true (panel hidden). */
  defaultOpen?: boolean;
}

export const LogPanel: React.FC<LogPanelProps> = ({ messages, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // When the user scrolls up to read older entries, freeze auto-scroll until
  // they return to the bottom. Compared each render against scrollHeight so
  // the freeze is accurate even when the buffer is mid-truncation.
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, open]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Within ~16px of the bottom counts as "at the bottom" — handles fractional
    // pixel rounding from CSS zoom and DPR-aware browsers.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 16;
  };

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="log-panel">
      <button
        type="button"
        className="log-panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="log-panel-toggle-icon" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{open ? 'Hide details' : 'Show details'}</span>
        <span className="log-panel-toggle-count" aria-label={`${messages.length} log entries`}>
          ({messages.length})
        </span>
      </button>
      {open && (
        // role="region" with an aria-label is the right semantic for a
        // collapsed-by-default developer-detail panel that the user has
        // explicitly opened. role="log" implies aria-live="polite", and
        // emitting ~36 entries over ~30s would spam screen readers (same
        // regression class as the wavelength ribbon in PR #1456). Users
        // who open this panel can read the buffer at their own pace.
        // aria-live="off" defends against an ancestor live region (e.g.
        // GuidedCreate's ProcessStep root) — without this override the
        // panel would announce all 50 entries when the user opens it.
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="log-panel-buffer"
          role="region"
          aria-label="Composite generation log"
          aria-live="off"
        >
          {messages.map((msg, i) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- buffer shifts on overflow so indices aren't stable per-message, but each row is a stateless plain text node, so React's key-based reconciliation produces correct DOM regardless
            <div key={i} className="log-panel-line">
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
