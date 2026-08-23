import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MastObservationResult } from '../../types/MastTypes';
import type { DataAvailabilityItem } from '../../types/JwstDataTypes';
import { CE_MODE } from '../../config/ce';
import { formatMjdDate } from '../../utils/timeUtils';
import { activeColumns, type ResultColumn } from './resultColumns';
import { nextSort, sortRows, type ResultSort } from './resultSort';
import './ResultsTable.css';

const PAGE_SIZES = [10, 25, 50, 100];

const formatExposureTime = (expTime: number | undefined) => {
  if (expTime === undefined || expTime === null) return '-';
  if (expTime < 1) return `${(expTime * 1000).toFixed(0)}ms`;
  if (expTime < 60) return `${expTime.toFixed(1)}s`;
  return `${(expTime / 60).toFixed(1)}m`;
};

function formatCell(row: MastObservationResult, column: ResultColumn): string {
  const value = row[column.key];
  if (column.key === 't_exptime') return formatExposureTime(value as number | undefined);
  if (column.kind === 'mjd') return formatMjdDate(value);
  if (column.key === 's_ra' || column.key === 's_dec') {
    return typeof value === 'number' ? value.toFixed(5) : '-';
  }
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

interface ResultsTableProps {
  /** The full result set (already filtered by the server); sorted and paged here. */
  rows: MastObservationResult[];
  sort: ResultSort;
  onSortChange: (next: ResultSort) => void;
  /** Optional column keys switched on in the column picker. */
  visibleColumns: Set<string>;
  selectedObs: ReadonlySet<string>;
  onToggleSelection: (obsId: string) => void;
  importing: string | null;
  onImport: (obsId: string) => void;
  isAuthenticated: boolean;
  /** Availability results keyed by MAST obs_id, from useLibraryAvailability. */
  availability: Record<string, DataAvailabilityItem>;
}

/**
 * Sortable, column-configurable results table with client-side paging.
 *
 * The server already returned everything it will (≤ page cap; the toolbar's
 * truncation banner says when that cap was hit), so sorting and paging are
 * local. Rows carry `id`/`data-obs-id` so the Phase 5 sky map can link
 * hover/selection to a row. Per-row actions: "In Library" badge, anonymous
 * "Log in to import" gate, Import.
 */
const ResultsTable: React.FC<ResultsTableProps> = ({
  rows,
  sort,
  onSortChange,
  visibleColumns,
  selectedObs,
  onToggleSelection,
  importing,
  onImport,
  isAuthenticated,
  availability,
}) => {
  // The page is tagged with the result set it belongs to, so a new result
  // set starts on page 1 without an effect.
  const [paging, setPaging] = useState<{ of: MastObservationResult[]; page: number }>(() => ({
    of: rows,
    page: 1,
  }));
  const [pageSize, setPageSize] = useState(10);
  const page = paging.of === rows ? paging.page : 1;
  const setPage = (next: number) => setPaging({ of: rows, page: next });

  const columns = useMemo(() => activeColumns(visibleColumns), [visibleColumns]);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  return (
    <div className="search-results">
      <div className="results-table-container">
        <table className="results-table">
          <thead>
            <tr>
              <th className="col-checkbox" scope="col">
                <span className="visually-hidden">Select</span>
              </th>
              {columns.map((c) => {
                const active = sort.key === c.key;
                const ariaSort = active
                  ? sort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`col-${c.key}${c.numeric ? ' col-numeric' : ''}`}
                  >
                    <button
                      type="button"
                      className={`sort-btn${active ? ' active' : ''}`}
                      onClick={() => onSortChange(nextSort(sort, c.key))}
                      title={`Sort by ${c.label}`}
                    >
                      {c.label}
                      <span className="sort-indicator" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▴' : '▾') : ''}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th className="col-actions" scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((result, index) => {
              const resultObsId = result.obs_id || `result-${start + index}`;
              const isAvailable = !!(result.obs_id && availability[result.obs_id]?.available);
              return (
                <tr
                  key={resultObsId}
                  id={result.obs_id ? `obs-${result.obs_id}` : undefined}
                  data-obs-id={result.obs_id}
                  className={selectedObs.has(resultObsId) ? 'selected' : undefined}
                >
                  <td className="col-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedObs.has(resultObsId)}
                      onChange={() => onToggleSelection(resultObsId)}
                      disabled={!result.obs_id || !isAuthenticated}
                      aria-label={`Select ${resultObsId}`}
                      title={
                        isAuthenticated ? undefined : 'Log in to select observations for import'
                      }
                    />
                  </td>
                  {columns.map((c) => {
                    const text = formatCell(result, c);
                    return (
                      <td
                        key={c.key}
                        className={`col-${c.key}${c.mono ? ' col-mono' : ''}${c.numeric ? ' col-numeric' : ''}`}
                        title={text !== '-' ? text : undefined}
                      >
                        {text}
                      </td>
                    );
                  })}
                  <td className="col-actions">
                    {isAvailable ? (
                      <button className="btn-base btn-standard import-btn imported" disabled>
                        In Library
                      </button>
                    ) : !isAuthenticated ? (
                      CE_MODE ? null : (
                        <Link
                          to="/login"
                          className="btn-base btn-standard import-btn login-to-import"
                        >
                          Log in to import
                        </Link>
                      )
                    ) : (
                      <button
                        onClick={() => result.obs_id && onImport(result.obs_id)}
                        disabled={importing === result.obs_id || !result.obs_id}
                        className="btn-base btn-standard import-btn"
                      >
                        {importing === result.obs_id ? 'Importing...' : 'Import'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls — paging is client-side over the rows the server
          returned, and the label says so. */}
      {totalPages > 1 && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length}{' '}
            loaded
          </div>
          <div className="pagination-controls">
            <button
              onClick={() => setPage(1)}
              disabled={current === 1}
              className="btn-base btn-compact pagination-btn"
              title="First page"
            >
              ««
            </button>
            <button
              onClick={() => setPage(Math.max(1, current - 1))}
              disabled={current === 1}
              className="btn-base btn-compact pagination-btn"
              title="Previous page"
            >
              «
            </button>
            <span className="pagination-pages">
              Page {current} of {totalPages} · {sorted.length} loaded
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, current + 1))}
              disabled={current === totalPages}
              className="btn-base btn-compact pagination-btn"
              title="Next page"
            >
              »
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={current === totalPages}
              className="btn-base btn-compact pagination-btn"
              title="Last page"
            >
              »»
            </button>
          </div>
          <div className="pagination-size">
            <label htmlFor="page-size">Per page:</label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsTable;
