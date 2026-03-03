import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import type Plotly from 'plotly.js';
import './SpectralViewer.css';
import { getSpectralData } from '../services/analysisService';
import type { SpectralDataResponse } from '../types/AnalysisTypes';

const Plot = React.lazy(() => import('react-plotly.js'));

interface SpectralViewerProps {
  dataId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenTable?: () => void;
}

const FLUX_COLUMN_PRIORITY = ['FLUX', 'SURF_BRIGHT', 'NET', 'BACKGROUND'];
const WAVELENGTH_NAMES = new Set(['WAVELENGTH', 'WAVE', 'LAMBDA']);

const SpectralViewer: React.FC<SpectralViewerProps> = ({
  dataId,
  title,
  isOpen,
  onClose,
  onOpenTable,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spectralData, setSpectralData] = useState<SpectralDataResponse | null>(null);
  const [selectedYColumn, setSelectedYColumn] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [plotDimensions, setPlotDimensions] = useState({ width: 800, height: 500 });

  // Fetch spectral data on open — with cancellation to prevent stale data
  useEffect(() => {
    if (!isOpen || !dataId) return;

    let cancelled = false;

    const fetchData = async () => {
      // Reset state for new data
      setLoading(true);
      setError(null);
      setSpectralData(null);
      setSelectedYColumn('');

      try {
        const data = await getSpectralData(dataId);
        if (cancelled) return;
        setSpectralData(data);

        // Auto-select y-axis column: prefer FLUX, then other known columns
        const colNames = data.columns.map((c) => c.name);
        const yColumns = colNames.filter((n) => !WAVELENGTH_NAMES.has(n.toUpperCase()));
        let defaultY = yColumns[0] || '';
        for (const preferred of FLUX_COLUMN_PRIORITY) {
          if (yColumns.includes(preferred)) {
            defaultY = preferred;
            break;
          }
        }
        setSelectedYColumn(defaultY);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load spectral data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [isOpen, dataId]);

  // Manual retry handler
  const handleRetry = useCallback(async () => {
    if (!dataId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await getSpectralData(dataId);
      setSpectralData(data);

      const colNames = data.columns.map((c) => c.name);
      const yColumns = colNames.filter((n) => !WAVELENGTH_NAMES.has(n.toUpperCase()));
      let defaultY = yColumns[0] || '';
      for (const preferred of FLUX_COLUMN_PRIORITY) {
        if (yColumns.includes(preferred)) {
          defaultY = preferred;
          break;
        }
      }
      setSelectedYColumn(defaultY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load spectral data');
    } finally {
      setLoading(false);
    }
  }, [dataId]);

  // Resize observer for responsive chart — re-run when data loads
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setPlotDimensions({ width, height });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isOpen, spectralData, loading]);

  // Handle Escape key — skip when focus is on interactive elements
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'SELECT') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Memoized derived state
  const yColumnOptions = useMemo(() => {
    if (!spectralData) return [];
    return spectralData.columns
      .filter((c) => !WAVELENGTH_NAMES.has(c.name.toUpperCase()))
      .filter((c) => c.name.toUpperCase() !== 'DQ');
  }, [spectralData]);

  const wavelengthName = useMemo(() => {
    if (!spectralData) return 'WAVELENGTH';
    const col = spectralData.columns.find((c) => WAVELENGTH_NAMES.has(c.name.toUpperCase()));
    return col?.name || 'WAVELENGTH';
  }, [spectralData]);

  // Get axis labels with units
  const getAxisLabel = useCallback(
    (colName: string): string => {
      if (!spectralData) return colName;
      const col = spectralData.columns.find((c) => c.name === colName);
      if (!col) return colName;
      return col.unit ? `${colName} (${col.unit})` : colName;
    },
    [spectralData]
  );

  // Check for error column (case-insensitive)
  const getErrorColumn = useCallback(
    (yCol: string): string | null => {
      if (!spectralData) return null;
      const colNames = spectralData.columns.map((c) => c.name);
      const colNamesUpper = colNames.map((n) => n.toUpperCase());
      const candidates = [`${yCol}_ERROR`, `${yCol}_ERR`, 'ERROR', 'FLUX_ERROR'];
      for (const candidate of candidates) {
        const idx = colNamesUpper.indexOf(candidate.toUpperCase());
        if (idx !== -1 && colNames[idx] !== yCol) {
          return colNames[idx];
        }
      }
      return null;
    },
    [spectralData]
  );

  // Memoize Plotly data to avoid re-creating on every render
  const traces = useMemo((): Partial<Plotly.Data>[] => {
    if (!spectralData || !selectedYColumn) return [];

    const xData = spectralData.data[wavelengthName] || [];
    const yData = spectralData.data[selectedYColumn] || [];
    const errorCol = getErrorColumn(selectedYColumn);

    const trace: Partial<Plotly.Data> = {
      x: xData as Plotly.Datum[],
      y: yData as Plotly.Datum[],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: selectedYColumn,
      line: { color: '#4db8ff', width: 1.2 },
      hovertemplate: `${wavelengthName}: %{x}<br>${selectedYColumn}: %{y}<extra></extra>`,
    };

    if (errorCol && spectralData.data[errorCol]) {
      const errorData = spectralData.data[errorCol];
      (trace as Record<string, unknown>).error_y = {
        type: 'data',
        array: errorData,
        visible: true,
        color: 'rgba(77, 184, 255, 0.3)',
        thickness: 1,
        width: 0,
      };
    }

    return [trace];
  }, [spectralData, selectedYColumn, wavelengthName, getErrorColumn]);

  const layout = useMemo(
    (): Partial<Plotly.Layout> => ({
      width: plotDimensions.width,
      height: plotDimensions.height,
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#0f0f23',
      font: { color: '#d8e2f3', family: 'system-ui, -apple-system, sans-serif' },
      xaxis: {
        title: { text: getAxisLabel(wavelengthName), font: { size: 13 } },
        gridcolor: 'rgba(120, 139, 177, 0.15)',
        zerolinecolor: 'rgba(120, 139, 177, 0.3)',
        tickfont: { size: 11 },
      },
      yaxis: {
        title: { text: getAxisLabel(selectedYColumn), font: { size: 13 } },
        gridcolor: 'rgba(120, 139, 177, 0.15)',
        zerolinecolor: 'rgba(120, 139, 177, 0.3)',
        tickfont: { size: 11 },
        exponentformat: 'e',
      },
      margin: { l: 80, r: 30, t: 20, b: 60 },
      hovermode: 'closest' as const,
      dragmode: 'zoom' as const,
      modebar: {
        bgcolor: 'transparent',
        color: '#8892b0',
        activecolor: '#4db8ff',
      },
    }),
    [plotDimensions, wavelengthName, selectedYColumn, getAxisLabel]
  );

  const config = useMemo(
    (): Partial<Plotly.Config> => ({
      responsive: false,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
      toImageButtonOptions: {
        format: 'png',
        filename: title.replace(/\.fits?$/i, '') + '_spectrum',
        scale: 2,
      },
    }),
    [title]
  );

  if (!isOpen) return null;

  const hasData = !loading && !error && spectralData;
  const isEmpty = hasData && yColumnOptions.length === 0;

  return (
    <div
      className="spectral-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="spectral-viewer-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="spectral-viewer-header">
          <div className="spectral-viewer-title">
            <h3>{title}</h3>
            {spectralData && (
              <span className="spectral-viewer-stats">
                {spectralData.nPoints.toLocaleString()} points
                {spectralData.hduName && ` — ${spectralData.hduName}`}
              </span>
            )}
          </div>
          <div className="spectral-viewer-controls">
            <button
              className="btn-base spectral-viewer-close-btn"
              onClick={onClose}
              title="Close (Escape)"
              aria-label="Close spectral viewer"
            >
              ×
            </button>
          </div>
        </div>

        {/* Toolbar */}
        {spectralData && yColumnOptions.length > 0 && (
          <div className="spectral-viewer-toolbar">
            <div className="spectral-toolbar-group">
              <span className="spectral-toolbar-label">Y-Axis:</span>
              <select
                className="spectral-column-selector"
                value={selectedYColumn}
                onChange={(e) => setSelectedYColumn(e.target.value)}
                aria-label="Select Y-axis column"
              >
                {yColumnOptions.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                    {col.unit ? ` (${col.unit})` : ''}
                  </option>
                ))}
              </select>
            </div>
            {onOpenTable && (
              <button
                className="btn-base spectral-open-table-btn"
                onClick={onOpenTable}
                title="View raw table data"
              >
                Open as Table
              </button>
            )}
          </div>
        )}

        {/* Chart body */}
        <div className="spectral-viewer-body">
          {error && (
            <div className="spectral-viewer-error">
              <p>{error}</p>
              <button className="btn-base spectral-retry-btn" onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}

          {loading && !error && (
            <div className="spectral-loading">
              <div className="spinner"></div>
            </div>
          )}

          {isEmpty && (
            <div className="spectral-viewer-empty">
              <p>No plottable columns found in this HDU.</p>
              {onOpenTable && (
                <button className="btn-base spectral-open-table-btn" onClick={onOpenTable}>
                  Open as Table
                </button>
              )}
            </div>
          )}

          {hasData && !isEmpty && (
            <div className="spectral-chart-container" ref={containerRef}>
              <Suspense
                fallback={
                  <div className="spectral-loading">
                    <div className="spinner"></div>
                  </div>
                }
              >
                <Plot data={traces} layout={layout} config={config} />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpectralViewer;
