import React, { useEffect, useId, useRef, useState } from 'react';
import type { DownloadSource } from '../../services';
import type { SearchView } from '../../hooks/useSearchUrlState';
import { CE_MODE } from '../../config/ce';
import { RESULT_COLUMNS } from './resultColumns';
import type { AvailabilityStatus } from './hooks/useLibraryAvailability';
import ImportOptionsPopover from './ImportOptionsPopover';
import './ResultsToolbar.css';

interface ResultsToolbarProps {
  count: number;
  truncated: boolean;
  pageSize: number;
  /** Optional column keys currently switched on. */
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  selectedCount: number;
  onBulkImport: () => void;
  importing: boolean;
  isAuthenticated: boolean;
  availabilityStatus: AvailabilityStatus;
  downloadSource: DownloadSource;
  onDownloadSourceChange: (value: DownloadSource) => void;
  view: SearchView;
  onViewChange: (view: SearchView) => void;
  /** Re-centre the sky map on the current results (split view only). */
  onFitMap?: () => void;
}

/** "Showing first N" — the server capped the result set. */
export const TruncationBanner: React.FC<{ pageSize: number }> = ({ pageSize }) => (
  <div className="truncation-banner" role="status">
    Showing the first {pageSize} observations MAST returned — there are more. Narrow the radius or
    add filters to see the rest.
  </div>
);

/**
 * Row above the results table: count, truncation banner, column picker,
 * selection + bulk import (+ import options), the table/split view toggle
 * (split = table + sky map, MAST Search v2 Phase 5) and, in split view,
 * "Fit map" to re-centre the map on the results.
 */
const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  count,
  truncated,
  pageSize,
  visibleColumns,
  onVisibleColumnsChange,
  selectedCount,
  onBulkImport,
  importing,
  isAuthenticated,
  availabilityStatus,
  downloadSource,
  onDownloadSourceChange,
  view,
  onViewChange,
  onFitMap,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerId = useId();

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as HTMLElement)) setPickerOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const toggleColumn = (key: string) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onVisibleColumnsChange(next);
  };

  const canImport = isAuthenticated && !CE_MODE;

  return (
    <div className="results-toolbar">
      <div className="results-toolbar-row">
        <h3 className="results-count">
          Search Results ({count})
          {selectedCount > 0 && (
            <span className="results-selected"> · {selectedCount} selected</span>
          )}
        </h3>

        {availabilityStatus === 'unavailable' && (
          <span className="results-availability-note" role="status">
            Library status unavailable — rows already in your library may still show Import.
          </span>
        )}

        <div className="results-toolbar-actions">
          <div className="results-view-toggle" role="group" aria-label="Results view">
            <button
              type="button"
              className="btn-base btn-compact results-view-btn"
              aria-pressed={view === 'table'}
              onClick={() => onViewChange('table')}
            >
              Table
            </button>
            <button
              type="button"
              className="btn-base btn-compact results-view-btn"
              aria-pressed={view === 'split'}
              onClick={() => onViewChange('split')}
              title="Table + sky map"
            >
              Split
            </button>
          </div>

          {view === 'split' && onFitMap && (
            <button
              type="button"
              className="btn-base btn-compact results-fit-map"
              onClick={onFitMap}
              title="Fit map to results"
            >
              Fit map to results
            </button>
          )}

          <div className="column-picker" ref={pickerRef}>
            <button
              type="button"
              className="btn-base btn-compact column-picker-trigger"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              onClick={() => setPickerOpen((o) => !o)}
            >
              Columns
            </button>
            {pickerOpen && (
              <div
                id={pickerId}
                role="dialog"
                aria-label="Choose columns"
                className="column-picker-panel"
              >
                {RESULT_COLUMNS.filter((c) => !c.fixed).map((c) => (
                  <label key={c.key} className="column-picker-option">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    <span>{c.label}</span>
                    <code className="column-picker-key">{c.key}</code>
                  </label>
                ))}
              </div>
            )}
          </div>

          {canImport && (
            <ImportOptionsPopover
              downloadSource={downloadSource}
              onDownloadSourceChange={onDownloadSourceChange}
            />
          )}

          {/* #1648: /archive became public in #1619, but only the per-row action
              grew an auth gate. Anonymous users could still select rows and fire
              a bulk import, which 401s every job and leaves the panel in a failed
              state with no hint that logging in is the answer. */}
          {selectedCount > 0 && isAuthenticated && (
            <button
              className="btn-base btn-large bulk-import-btn"
              onClick={onBulkImport}
              disabled={importing}
            >
              Import Selected ({selectedCount})
            </button>
          )}
        </div>
      </div>

      {truncated && <TruncationBanner pageSize={pageSize} />}
    </div>
  );
};

export default ResultsToolbar;
