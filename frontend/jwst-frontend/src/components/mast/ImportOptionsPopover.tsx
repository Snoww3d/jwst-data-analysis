import React, { useEffect, useId, useRef, useState } from 'react';
import type { DownloadSource } from '../../services';
import './ImportOptionsPopover.css';

const SOURCE_LABELS: Record<DownloadSource, string> = {
  auto: 'Auto (S3 preferred)',
  s3: 'S3 Direct',
  http: 'HTTP (MAST)',
};

const SOURCE_SHORT: Record<DownloadSource, string> = {
  auto: 'Auto',
  s3: 'S3',
  http: 'HTTP',
};

interface ImportOptionsPopoverProps {
  downloadSource: DownloadSource;
  onDownloadSourceChange: (value: DownloadSource) => void;
  disabled?: boolean;
}

/**
 * Options that apply to every import started from this page (single or
 * bulk) — today just the download source. A small popover beside the import
 * actions, so the setting lives where it takes effect rather than in the
 * search form (MAST Search v2 Phase 3; non-CE, authenticated only — the
 * caller gates it).
 */
const ImportOptionsPopover: React.FC<ImportOptionsPopoverProps> = ({
  downloadSource,
  onDownloadSourceChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const selectId = useId();

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="import-options" ref={rootRef}>
      <button
        type="button"
        className="btn-base btn-compact import-options-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Import options"
      >
        Import options
        <span className="import-options-current">{SOURCE_SHORT[downloadSource]}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Import options"
          className="import-options-panel"
        >
          <label className="download-source-label" htmlFor={selectId}>
            <span>Download source</span>
            <select
              id={selectId}
              value={downloadSource}
              onChange={(e) => onDownloadSourceChange(e.target.value as DownloadSource)}
              className="download-source-select"
            >
              {(Object.keys(SOURCE_LABELS) as DownloadSource[]).map((k) => (
                <option key={k} value={k}>
                  {SOURCE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <p className="import-options-hint">
            Applies to Import and Import Selected. Auto tries S3 first and falls back to MAST over
            HTTP.
          </p>
        </div>
      )}
    </div>
  );
};

export default ImportOptionsPopover;
