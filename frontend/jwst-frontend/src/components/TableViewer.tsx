import React, { useState, useEffect, useCallback, useRef } from 'react';
import './TableViewer.css';
import { getTableInfo, getTableData } from '../services/analysisService';
import type { TableHduInfo, TableColumnInfo, TableDataResponse } from '../types/AnalysisTypes';

interface TableViewerProps {
  dataId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenSpectrum?: () => void;
}

const PAGE_SIZES = [50, 100, 200, 500];

const TableViewer: React.FC<TableViewerProps> = ({
  dataId,
  title,
  isOpen,
  onClose,
  onOpenSpectrum,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableHdus, setTableHdus] = useState<TableHduInfo[]>([]);
  const [selectedHduIndex, setSelectedHduIndex] = useState<number>(0);
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch table info on open
  useEffect(() => {
    if (!isOpen || !dataId) return;

    let cancelled = false;
    const fetchInfo = async () => {
      setLoading(true);
      setError(null);
      setTableHdus([]);
      setTableData(null);
      setPage(0);
      setSortColumn(null);
      setSortDirection(null);
      setSearchTerm('');
      setSearchInput('');

      try {
        const info = await getTableInfo(dataId);
        if (cancelled) return;
        setTableHdus(info.tableHdus);
        if (info.tableHdus.length > 0) {
          setSelectedHduIndex(info.tableHdus[0].index);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load table info');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, [isOpen, dataId]);

  // Fetch table data when HDU, page, sort, or search changes
  useEffect(() => {
    if (!isOpen || !dataId || tableHdus.length === 0) return;

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const data = await getTableData({
          dataId,
          hduIndex: selectedHduIndex,
          page,
          pageSize,
          sortColumn,
          sortDirection,
          search: searchTerm || undefined,
        });
        if (!cancelled) {
          setTableData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load table data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    dataId,
    selectedHduIndex,
    page,
    pageSize,
    sortColumn,
    sortDirection,
    searchTerm,
    tableHdus.length,
  ]);

  // Handle search input with debounce
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchTerm(value);
      setPage(0);
    }, 300);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Handle sort click: asc → desc → clear
  const handleSortClick = useCallback(
    (colName: string) => {
      if (colName !== sortColumn) {
        setSortColumn(colName);
        setSortDirection('asc');
        setPage(0);
      } else if (sortDirection === 'asc') {
        setSortDirection('desc');
        setPage(0);
      } else {
        setSortColumn(null);
        setSortDirection(null);
        setPage(0);
      }
    },
    [sortColumn, sortDirection]
  );

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'INPUT') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Pagination helpers
  const totalPages = tableData ? Math.max(1, Math.ceil(tableData.totalRows / pageSize)) : 1;

  // Export CSV
  const handleExportCsv = useCallback(() => {
    if (!tableData || tableData.rows.length === 0) return;

    const colNames = tableData.columns.map((c) => c.name);
    const header = colNames.join(',');
    const rows = tableData.rows.map((row) =>
      colNames
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          // Escape CSV values with commas or quotes
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/\.fits$/i, '')}_page${page + 1}-of-${totalPages}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [tableData, title, page, totalPages]);

  const selectedHdu = tableHdus.find((h) => h.index === selectedHduIndex);

  // Format cell value for display
  const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return '\u2014'; // em-dash
    return String(value);
  };

  // Determine if a column is numeric based on FITS format code
  // FITS formats: E=float32, D=float64, I=int16, J=int32, K=int64, B=uint8, A=string, L=logical
  // Formats look like "1E", "1D", "10E", "20A", "1PE(300)" (variable-length)
  const isNumericColumn = (col: TableColumnInfo): boolean => {
    const numericCodes = new Set(['E', 'D', 'I', 'J', 'K', 'B']);
    const format = col.dtype.toUpperCase();
    // Extract the type character: strip leading digits, take first alpha char
    const typeChar = format.replace(/^[0-9]+/, '').charAt(0);
    return numericCodes.has(typeChar);
  };

  if (!isOpen) return null;

  return (
    <div className="table-viewer-overlay" onClick={onClose}>
      <div className="table-viewer-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="table-viewer-header">
          <div className="table-viewer-title">
            <h3>{title}</h3>
            {selectedHdu && (
              <span className="table-viewer-stats">
                {selectedHdu.nRows.toLocaleString()} rows × {selectedHdu.nColumns} columns
                {selectedHdu.name && ` — ${selectedHdu.name}`}
              </span>
            )}
          </div>
          <div className="table-viewer-controls">
            {tableHdus.length > 1 && (
              <select
                className="hdu-selector"
                aria-label="Select table HDU"
                value={selectedHduIndex}
                onChange={(e) => {
                  setSelectedHduIndex(Number(e.target.value));
                  setPage(0);
                  setSortColumn(null);
                  setSortDirection(null);
                }}
              >
                {tableHdus.map((hdu) => (
                  <option key={hdu.index} value={hdu.index}>
                    HDU {hdu.index}
                    {hdu.name ? ` — ${hdu.name}` : ''} ({hdu.nRows} rows)
                  </option>
                ))}
              </select>
            )}
            <button
              className="table-viewer-close-btn"
              onClick={onClose}
              title="Close (Escape)"
              aria-label="Close table viewer"
            >
              ×
            </button>
          </div>
        </div>

        {/* Search and export bar */}
        <div className="table-viewer-toolbar">
          <div className="table-search-wrapper">
            <input
              type="text"
              className="table-search-input"
              placeholder="Search table..."
              aria-label="Search table data"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {searchInput && (
              <button
                className="table-search-clear"
                onClick={() => handleSearchChange('')}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {onOpenSpectrum && (
            <button
              className="table-open-spectrum-btn"
              onClick={onOpenSpectrum}
              title="View as spectrum plot"
            >
              View Spectrum
            </button>
          )}
          <button
            className="table-export-btn"
            onClick={handleExportCsv}
            disabled={!tableData || tableData.rows.length === 0}
            title="Export current page as CSV"
          >
            Export CSV
          </button>
        </div>

        {/* Table content */}
        <div className="table-viewer-body">
          {error && (
            <div className="table-viewer-error">
              <p>{error}</p>
            </div>
          )}

          {!error && tableHdus.length === 0 && !loading && (
            <div className="table-viewer-empty">
              <p>No table data found in this file.</p>
            </div>
          )}

          {!error && tableData && tableData.rows.length === 0 && !loading && (
            <div className="table-viewer-empty">
              <p>No rows{searchTerm ? ' match your search' : ' in this table'}.</p>
            </div>
          )}

          {((tableData && tableData.rows.length > 0) || loading) && (
            <div className="table-scroll-container">
              {loading && (
                <div className="table-loading-overlay">
                  <div className="spinner"></div>
                </div>
              )}
              {tableData && tableData.rows.length > 0 && (
                <table className="fits-table">
                  <thead>
                    <tr>
                      <th className="row-number-col">#</th>
                      {tableData.columns.map((col) => (
                        <th
                          key={col.name}
                          className={`${!col.isArray ? 'sortable-header' : ''} ${isNumericColumn(col) ? 'numeric' : ''}`}
                          onClick={() => !col.isArray && handleSortClick(col.name)}
                          aria-sort={
                            sortColumn === col.name
                              ? sortDirection === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : undefined
                          }
                          title={[
                            col.name,
                            col.unit ? `Unit: ${col.unit}` : null,
                            col.dtype ? `Type: ${col.dtype}` : null,
                          ]
                            .filter(Boolean)
                            .join(' | ')}
                        >
                          <span className="header-text">{col.name}</span>
                          {col.unit && <span className="header-unit">({col.unit})</span>}
                          {sortColumn === col.name && (
                            <span className="sort-indicator">
                              {sortDirection === 'asc' ? ' \u25B2' : ' \u25BC'}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        <td className="row-number-col">
                          {(tableData.page * tableData.pageSize + rowIdx + 1).toLocaleString()}
                        </td>
                        {tableData.columns.map((col) => {
                          const val = row[col.name];
                          const display = formatCell(val);
                          const isNull = val === null || val === undefined;
                          return (
                            <td
                              key={col.name}
                              className={`${isNumericColumn(col) ? 'numeric' : ''} ${isNull ? 'null-cell' : ''} ${col.isArray ? 'array-cell' : ''}`}
                              title={col.isArray && !isNull ? String(val) : undefined}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Pagination footer */}
        {tableData && tableData.totalRows > 0 && (
          <div className="table-viewer-footer">
            <div className="pagination-info">
              Showing {(tableData.page * pageSize + 1).toLocaleString()}–
              {Math.min((tableData.page + 1) * pageSize, tableData.totalRows).toLocaleString()} of{' '}
              {tableData.totalRows.toLocaleString()} rows
            </div>
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={page === 0}
                onClick={() => setPage(0)}
                title="First page"
              >
                ««
              </button>
              <button
                className="pagination-btn"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                title="Previous page"
              >
                «
              </button>
              <span className="pagination-page">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                title="Next page"
              >
                »
              </button>
              <button
                className="pagination-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
                title="Last page"
              >
                »»
              </button>
              <select
                className="page-size-selector"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TableViewer;
