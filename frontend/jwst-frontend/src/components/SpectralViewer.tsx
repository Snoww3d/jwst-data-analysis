import React, { useState, useEffect, useCallback, useRef } from 'react';
import type Plotly from 'plotly.js';
import Plot from 'react-plotly.js';
import './SpectralViewer.css';
import { getSpectralData } from '../services/analysisService';
import type { SpectralDataResponse } from '../types/AnalysisTypes';

interface SpectralViewerProps {
  dataId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenTable?: () => void;
}

const FLUX_COLUMN_PRIORITY = ['FLUX', 'SURF_BRIGHT', 'NET', 'BACKGROUND'];

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

  // Fetch spectral data on open
  const fetchData = useCallback(async () => {
    if (!dataId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await getSpectralData(dataId);
      setSpectralData(data);

      // Auto-select y-axis column: prefer FLUX, then other known columns
      const colNames = data.columns.map((c) => c.name);
      const yColumns = colNames.filter((n) => n !== 'WAVELENGTH' && n !== 'WAVE' && n !== 'LAMBDA');
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

  useEffect(() => {
    if (!isOpen || !dataId) return;
    fetchData();
  }, [isOpen, dataId, fetchData]);

  // Resize observer for responsive chart
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
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Determine available y-axis columns (everything except wavelength)
  const wavelengthNames = new Set(['WAVELENGTH', 'WAVE', 'LAMBDA']);
  const yColumnOptions = spectralData
    ? spectralData.columns
        .filter((c) => !wavelengthNames.has(c.name.toUpperCase()))
        .filter((c) => c.name !== 'DQ') // DQ is not useful for plotting
    : [];

  // Find the wavelength column name
  const wavelengthCol = spectralData?.columns.find((c) =>
    wavelengthNames.has(c.name.toUpperCase())
  );
  const wavelengthName = wavelengthCol?.name || 'WAVELENGTH';

  // Get axis labels with units
  const getAxisLabel = (colName: string): string => {
    if (!spectralData) return colName;
    const col = spectralData.columns.find((c) => c.name === colName);
    if (!col) return colName;
    return col.unit ? `${colName} (${col.unit})` : colName;
  };

  // Check for error column
  const getErrorColumn = (yCol: string): string | null => {
    if (!spectralData) return null;
    const colNames = spectralData.columns.map((c) => c.name);
    // Common error column naming patterns
    const candidates = [`${yCol}_ERROR`, `${yCol}_ERR`, 'ERROR', 'FLUX_ERROR'];
    for (const candidate of candidates) {
      if (colNames.includes(candidate) && candidate !== yCol) {
        return candidate;
      }
    }
    return null;
  };

  // Build Plotly traces
  const buildTraces = (): Partial<Plotly.Data>[] => {
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
  };

  const layout: Partial<Plotly.Layout> = {
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
  };

  const config: Partial<Plotly.Config> = {
    responsive: false, // We handle sizing ourselves
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    toImageButtonOptions: {
      format: 'png',
      filename: title.replace(/\.fits$/i, '') + '_spectrum',
      scale: 2,
    },
  };

  return (
    <div className="spectral-viewer-overlay" onClick={onClose}>
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
              className="spectral-viewer-close-btn"
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
                className="spectral-open-table-btn"
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
              <button className="spectral-retry-btn" onClick={fetchData}>
                Retry
              </button>
            </div>
          )}

          {loading && !error && (
            <div className="spectral-loading">
              <div className="spinner"></div>
            </div>
          )}

          {!loading && !error && spectralData && (
            <div className="spectral-chart-container" ref={containerRef}>
              <Plot data={buildTraces()} layout={layout} config={config} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpectralViewer;
