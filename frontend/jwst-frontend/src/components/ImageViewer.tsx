import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ImageViewer.css';
import './FitsViewer.css';
import { API_BASE_URL } from '../config/api';
import StretchControls, { StretchParams } from './StretchControls';
import HistogramPanel, { HistogramData, PercentileData, HistogramStats } from './HistogramPanel';
import ExportOptionsPanel from './ExportOptionsPanel';
import CubeNavigator from './CubeNavigator';
import RegionSelector from './RegionSelector';
import RegionStatisticsPanel from './RegionStatisticsPanel';
import CurvesEditor from './CurvesEditor';
import AnnotationOverlay from './AnnotationOverlay';
import type { Annotation, AnnotationToolType, AnnotationColor } from '../types/AnnotationTypes';
import { DEFAULT_ANNOTATION_COLOR, ANNOTATION_COLORS } from '../types/AnnotationTypes';
import WcsGridOverlay from './WcsGridOverlay';
import {
  PixelDataResponse,
  CursorInfo,
  ExportOptions,
  ExportFormat,
  CubeInfoResponse,
} from '../types/JwstDataTypes';
import type { ImageMetadata } from '../types/JwstDataTypes';
import type {
  RegionType,
  RectangleRegion,
  EllipseRegion,
  RegionStatisticsResponse,
} from '../types/AnalysisTypes';
import type { CurveControlPoint, CurvePresetName } from '../types/CurvesTypes';
import { jwstDataService } from '../services/jwstDataService';
import { apiClient } from '../services/apiClient';
import { getRegionStatistics } from '../services/analysisService';
import {
  decodePixelData,
  calculateCursorInfo,
  formatRA,
  formatDec,
  formatPixelValue,
} from '../utils/coordinateUtils';
import { getDefaultPlaybackSpeed } from '../utils/cubeUtils';
import { isValidObjectId } from '../utils/validationUtils';
import {
  generateLUT,
  isIdentityCurve,
  getDefaultControlPoints,
  getPresetControlPoints,
  applyLUT,
} from '../utils/curvesUtils';

interface ImageViewerProps {
  dataId: string;
  title: string;
  onClose: () => void;
  isOpen: boolean;
  metadata?: Record<string, unknown>;
  imageInfo?: ImageMetadata;
  onCompare?: () => void;
}

// SVG Icons
const Icons = {
  Back: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
  ),
  Download: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  ),
  ZoomIn: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  ),
  ZoomOut: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  ),
  Palette: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
    </svg>
  ),
  Export: () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    </svg>
  ),
  TextTool: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 7 4 4 20 4 20 7"></polyline>
      <line x1="9" y1="20" x2="15" y2="20"></line>
      <line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>
  ),
  ArrowTool: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="19" x2="19" y2="5"></line>
      <polyline points="12 5 19 5 19 12"></polyline>
    </svg>
  ),
  CircleTool: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9"></circle>
    </svg>
  ),
  Trash: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  ),
  ChevronRight: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  ),
  ChevronLeft: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  ),
};

const COLORMAPS = [
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'hot', label: 'Hot' },
  { value: 'cool', label: 'Cool' },
  { value: 'rainbow', label: 'Rainbow' },
];

const DEFAULT_STRETCH_PARAMS: StretchParams = {
  stretch: 'zscale',
  gamma: 1.0,
  blackPoint: 0.0,
  whitePoint: 1.0,
  asinhA: 0.1,
};

const COMPACT_VIEWPORT_WIDTH = 900;

const generateExportFilename = (
  metadata?: Record<string, unknown>,
  fallbackTitle?: string,
  format: ExportFormat = 'png',
  imageInfo?: ImageMetadata
): string => {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', '_').replace(/[:.]/g, '').slice(0, 17);
  const extension = format === 'jpeg' ? 'jpg' : 'png';

  const obsId = (metadata?.mast_obs_id as string) || '';
  const instrument = (metadata?.mast_instrument_name as string) || imageInfo?.instrument || '';
  const filter = (metadata?.mast_filters as string) || imageInfo?.filter || '';

  const parts: string[] = [];
  if (obsId) parts.push(obsId.split('_')[0]?.toLowerCase() || obsId.toLowerCase());
  if (instrument) parts.push(instrument.toLowerCase());
  if (filter) parts.push(filter.toLowerCase());
  parts.push(timestamp);

  if (parts.length === 1) {
    const baseName =
      fallbackTitle?.replace(/\.fits$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'jwst_export';
    return `${baseName}_${timestamp}.${extension}`;
  }
  return `${parts.join('_')}.${extension}`;
};

const ImageViewer: React.FC<ImageViewerProps> = ({
  dataId,
  title,
  onClose,
  isOpen,
  metadata,
  imageInfo,
  onCompare,
}) => {
  const [isCompactLayout, setIsCompactLayout] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth <= COMPACT_VIEWPORT_WIDTH
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [colormap, setColormap] = useState<string>('grayscale');
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imageKey, setImageKey] = useState<number>(0);
  const [stretchParams, setStretchParams] = useState<StretchParams>(DEFAULT_STRETCH_PARAMS);
  const [pendingStretchParams, setPendingStretchParams] =
    useState<StretchParams>(DEFAULT_STRETCH_PARAMS);
  const [stretchControlsCollapsed, setStretchControlsCollapsed] = useState<boolean>(false);
  const [metadataCollapsed, setMetadataCollapsed] = useState<boolean>(true);

  // Histogram state
  const [histogramData, setHistogramData] = useState<HistogramData | null>(null);
  const [rawHistogramData, setRawHistogramData] = useState<HistogramData | null>(null);
  const [histogramPercentiles, setHistogramPercentiles] = useState<PercentileData | null>(null);
  const [histogramStats, setHistogramStats] = useState<HistogramStats | null>(null);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);
  const [stretchedHistogramCollapsed, setStretchedHistogramCollapsed] = useState<boolean>(false);
  const [rawHistogramCollapsed, setRawHistogramCollapsed] = useState<boolean>(false);

  // Pixel data state for hover coordinate display
  const [pixelData, setPixelData] = useState<PixelDataResponse | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showExportOptions, setShowExportOptions] = useState<boolean>(false);
  const [pixels, setPixels] = useState<Float32Array | null>(null);
  const [pixelDataLoading, setPixelDataLoading] = useState<boolean>(false);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null);

  // Authenticated preview image blob URL
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // 3D Cube navigator state
  const [cubeInfo, setCubeInfo] = useState<CubeInfoResponse | null>(null);
  const [currentSlice, setCurrentSlice] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(5);
  const [cubeNavigatorCollapsed, setCubeNavigatorCollapsed] = useState<boolean>(false);

  // Region selection state
  const [regionMode, setRegionMode] = useState<RegionType | null>(null);
  const [regionStats, setRegionStats] = useState<RegionStatisticsResponse | null>(null);
  const [regionStatsLoading, setRegionStatsLoading] = useState<boolean>(false);
  const [regionStatsError, setRegionStatsError] = useState<string | null>(null);
  const [regionStatsCollapsed, setRegionStatsCollapsed] = useState<boolean>(false);
  const [showRegionStats, setShowRegionStats] = useState<boolean>(false);

  // Curves adjustment state
  const [curvePoints, setCurvePoints] = useState<CurveControlPoint[]>(getDefaultControlPoints());
  const [curvePreset, setCurvePreset] = useState<CurvePresetName | null>('linear');
  const [curvesCollapsed, setCurvesCollapsed] = useState<boolean>(false);
  const [curvesActive, setCurvesActive] = useState<boolean>(false);

  // Annotation state
  const [annotationTool, setAnnotationTool] = useState<AnnotationToolType | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationColor, setAnnotationColor] = useState<AnnotationColor>(DEFAULT_ANNOTATION_COLOR);

  // WCS grid overlay state
  const [showWcsGrid, setShowWcsGrid] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track original values for stretched panel drag (to avoid compounding updates)
  const stretchedDragStartRef = useRef<{ blackPoint: number; whitePoint: number } | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth <= COMPACT_VIEWPORT_WIDTH);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isOpen || !isCompactLayout) return;

    // Compact view starts in a content-first mode to keep the image viewable.
    setMetadataCollapsed(true);
    setStretchControlsCollapsed(true);
    setStretchedHistogramCollapsed(true);
    setRawHistogramCollapsed(true);
    setCubeNavigatorCollapsed(true);
    setCurvesCollapsed(true);
    setRegionStatsCollapsed(true);
    setShowRegionStats(false);
    setShowExportOptions(false);
  }, [isOpen, isCompactLayout]);

  // Fetch preview image with auth token and convert to blob URL
  useEffect(() => {
    if (!isOpen || !dataId) return;

    let revoked = false;
    const fetchPreview = async () => {
      setLoading(true);
      setError(null);
      const url =
        `${API_BASE_URL}/api/jwstdata/${dataId}/preview?` +
        `cmap=${colormap}` +
        `&width=1200&height=1200` +
        `&stretch=${stretchParams.stretch}` +
        `&gamma=${stretchParams.gamma}` +
        `&blackPoint=${stretchParams.blackPoint}` +
        `&whitePoint=${stretchParams.whitePoint}` +
        `&asinhA=${stretchParams.asinhA}` +
        `&sliceIndex=${cubeInfo?.is_cube ? currentSlice : -1}`;
      try {
        const token = localStorage.getItem('jwst_auth_token');
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          const detail = await response
            .json()
            .then((d) => d.detail)
            .catch(() => null);
          throw new Error(detail || `Preview failed (${response.status})`);
        }
        const blob = await response.blob();
        if (revoked) return;
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch (err) {
        if (!revoked) setError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        if (!revoked) setLoading(false);
      }
    };
    fetchPreview();
    return () => {
      revoked = true;
    };
  }, [isOpen, dataId, colormap, stretchParams, cubeInfo?.is_cube, currentSlice, imageKey]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Reset view when opening
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setStretchParams(DEFAULT_STRETCH_PARAMS);
      setPendingStretchParams(DEFAULT_STRETCH_PARAMS);
      setHistogramData(null);
      setRawHistogramData(null);
      setHistogramPercentiles(null);
      setHistogramStats(null);
      // Reset pixel data state
      setPixelData(null);
      setPixels(null);
      setCursorInfo(null);
      // Reset cube navigator state
      setCubeInfo(null);
      setCurrentSlice(0);
      setIsPlaying(false);
      // Reset curves state
      setCurvePoints(getDefaultControlPoints());
      setCurvePreset('linear');
      setCurvesActive(false);
      // Reset annotation state
      setAnnotations([]);
      setAnnotationTool(null);
      setAnnotationColor(DEFAULT_ANNOTATION_COLOR);
      // Reset WCS grid state
      setShowWcsGrid(false);
    }
  }, [isOpen, dataId]);

  // Fetch cube info when viewer opens (to determine if this is a 3D cube)
  useEffect(() => {
    if (!isOpen || !dataId) return;

    const fetchCubeInfo = async () => {
      try {
        const info = await jwstDataService.getCubeInfo(dataId);
        setCubeInfo(info);
        // Set default slice to middle if it's a cube
        if (info.is_cube && info.n_slices > 1) {
          setCurrentSlice(Math.floor(info.n_slices / 2));
          setPlaybackSpeed(getDefaultPlaybackSpeed(info.n_slices));
        }
      } catch (err) {
        console.error('Failed to fetch cube info:', err);
        // Non-fatal error - viewer still works as a 2D viewer
      }
    };

    fetchCubeInfo();
  }, [isOpen, dataId]);

  // Fetch pixel data when viewer opens (for hover coordinate display)
  // Also refetch when slice changes for 3D cubes
  useEffect(() => {
    if (!isOpen || !dataId) return;

    const fetchPixelData = async () => {
      setPixelDataLoading(true);
      try {
        const sliceIndex = cubeInfo?.is_cube ? currentSlice : -1;
        const data = await jwstDataService.getPixelData(dataId, 1200, sliceIndex);
        setPixelData(data);
        // Decode the base64 pixel array
        const decodedPixels = decodePixelData(data.pixels);
        setPixels(decodedPixels);
      } catch (err) {
        console.error('Failed to fetch pixel data:', err);
        // Non-fatal error - viewer still works without hover data
      } finally {
        setPixelDataLoading(false);
      }
    };

    fetchPixelData();
  }, [isOpen, dataId, cubeInfo?.is_cube, currentSlice]);

  // Fetch histogram data when viewer opens OR stretch params change OR slice changes
  // Uses committed stretchParams (not pending) so histogram updates after debounce,
  // synchronized with when the preview image updates
  useEffect(() => {
    if (!isOpen || !dataId) return;

    const fetchHistogram = async () => {
      setHistogramLoading(true);
      try {
        const sliceIndex = cubeInfo?.is_cube ? currentSlice : -1;
        const params = new URLSearchParams({
          stretch: stretchParams.stretch,
          gamma: stretchParams.gamma.toString(),
          blackPoint: stretchParams.blackPoint.toString(),
          whitePoint: stretchParams.whitePoint.toString(),
          asinhA: stretchParams.asinhA.toString(),
          sliceIndex: sliceIndex.toString(),
        });
        const data = await apiClient.get<{
          histogram: HistogramData;
          raw_histogram?: HistogramData;
          percentiles: PercentileData;
          stats: HistogramStats;
        }>(`/api/jwstdata/${dataId}/histogram?${params}`);
        setHistogramData(data.histogram);
        setRawHistogramData(data.raw_histogram || null);
        setHistogramPercentiles(data.percentiles);
        setHistogramStats(data.stats);
      } catch (err) {
        console.error('Failed to fetch histogram:', err);
      } finally {
        setHistogramLoading(false);
      }
    };

    fetchHistogram();
  }, [isOpen, dataId, stretchParams, cubeInfo?.is_cube, currentSlice]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Cube playback - advances only after previous image loads
  // This ensures smooth playback at whatever speed the backend can deliver
  const pendingAdvanceRef = useRef<boolean>(false);

  // When playing, mark that we want to advance after the current image loads
  useEffect(() => {
    if (isPlaying && cubeInfo?.is_cube) {
      pendingAdvanceRef.current = true;
    } else {
      pendingAdvanceRef.current = false;
    }
  }, [isPlaying, cubeInfo?.is_cube]);

  // Called when the preview image finishes loading
  const handleImageLoadForPlayback = useCallback(() => {
    if (!pendingAdvanceRef.current || !cubeInfo?.is_cube) return;

    // Add minimum delay based on playback speed setting
    const minDelayMs = 1000 / playbackSpeed;
    setTimeout(() => {
      if (pendingAdvanceRef.current && cubeInfo?.is_cube) {
        setCurrentSlice((prev) => {
          const next = prev + 1;
          return next >= cubeInfo.n_slices ? 0 : next;
        });
        setImageKey((k) => k + 1);
      }
    }, minDelayMs);
  }, [playbackSpeed, cubeInfo?.is_cube, cubeInfo?.n_slices]);

  // Cube slice change handler - triggers image reload
  const handleSliceChange = useCallback((newSlice: number) => {
    setCurrentSlice(newSlice);
    setLoading(true);
    setImageKey((prev) => prev + 1);
  }, []);

  // Cube play/pause toggle
  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Cube playback speed change
  const handlePlaybackSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  // Handle stretch parameter changes with debouncing
  const handleStretchParamsChange = useCallback((newParams: StretchParams) => {
    // Update pending params immediately for responsive UI display
    setPendingStretchParams(newParams);

    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to commit changes after 500ms of no changes
    debounceTimerRef.current = setTimeout(() => {
      setStretchParams(newParams);
      setLoading(true);
      setImageKey((prev) => prev + 1);
    }, 500);
  }, []);

  // Handlers for histogram black/white point changes (Raw panel - direct values)
  const handleHistogramBlackPointChange = useCallback(
    (value: number) => {
      const newParams = { ...pendingStretchParams, blackPoint: value };
      handleStretchParamsChange(newParams);
    },
    [pendingStretchParams, handleStretchParamsChange]
  );

  const handleHistogramWhitePointChange = useCallback(
    (value: number) => {
      const newParams = { ...pendingStretchParams, whitePoint: value };
      handleStretchParamsChange(newParams);
    },
    [pendingStretchParams, handleStretchParamsChange]
  );

  // Calculate Zoomed View Domain
  // The panel focuses on the active range [BlackPoint, WhitePoint] with some padding
  const activeRange = pendingStretchParams.whitePoint - pendingStretchParams.blackPoint;
  const viewPadding = Math.max(0.05, activeRange * 0.1); // at least 5% or 10% of range
  const viewMin = Math.max(0, pendingStretchParams.blackPoint - viewPadding);
  const viewMax = Math.min(1, pendingStretchParams.whitePoint + viewPadding);
  const zoomedDomain = { min: viewMin, max: viewMax };

  // Handlers for stretched panel - NO MORE RELATIVE DRAG
  // Since HistogramPanel now uses 'zoomedDomain' to map pixels to values,
  // the 'value' passed back is already the correct absolute value.
  const handleStretchedBlackPointChange = useCallback(
    (value: number) => {
      // Simple direct mapping updates
      const newParams = { ...pendingStretchParams, blackPoint: value };
      handleStretchParamsChange(newParams);
    },
    [pendingStretchParams, handleStretchParamsChange]
  );

  const handleStretchedWhitePointChange = useCallback(
    (value: number) => {
      // Simple direct mapping updates
      const newParams = { ...pendingStretchParams, whitePoint: value };
      handleStretchParamsChange(newParams);
    },
    [pendingStretchParams, handleStretchParamsChange]
  );

  // Clear the drag start ref when drag ends (called from HistogramPanel)
  const handleStretchedDragEnd = useCallback(() => {
    // No-op now, but kept for interface compatibility
    stretchedDragStartRef.current = null;
  }, []);

  // Handle colormap change
  const handleColormapChange = (newCmap: string) => {
    setColormap(newCmap);
    setLoading(true);
    setImageKey((prev) => prev + 1);
  };

  // Annotation tool switching (mutual exclusion with region mode)
  const handleAnnotationToolChange = useCallback((tool: AnnotationToolType | null) => {
    setAnnotationTool((prev) => (prev === tool ? null : tool));
    if (tool !== null) {
      setRegionMode(null); // Deactivate region mode
    }
  }, []);

  const handleAnnotationAdd = useCallback((annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation]);
  }, []);

  const handleAnnotationSelect = useCallback((id: string | null) => {
    setAnnotations((prev) => prev.map((ann) => ({ ...ann, selected: ann.id === id })));
  }, []);

  const handleAnnotationDelete = useCallback(() => {
    setAnnotations((prev) => prev.filter((ann) => !ann.selected));
  }, []);

  const handleAnnotationClearAll = useCallback(() => {
    setAnnotations([]);
    setAnnotationTool(null);
  }, []);

  // Handle keyboard shortcuts (escape + cube navigation + annotation delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Don't handle shortcuts when typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Escape to close (or deselect annotation first)
      if (e.key === 'Escape') {
        if (annotations.some((a) => a.selected)) {
          handleAnnotationSelect(null);
          return;
        }
        if (annotationTool) {
          setAnnotationTool(null);
          return;
        }
        onClose();
        return;
      }

      // Delete/Backspace to remove selected annotation
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (annotations.some((a) => a.selected)) {
          e.preventDefault();
          handleAnnotationDelete();
          return;
        }
      }

      // Cube navigation shortcuts (only when cube is available)
      if (cubeInfo?.is_cube && cubeInfo.n_slices > 1) {
        const maxSlice = cubeInfo.n_slices - 1;

        if (e.key === 'ArrowLeft' || e.key === ',') {
          e.preventDefault();
          setCurrentSlice((prev) => (prev > 0 ? prev - 1 : maxSlice));
          setLoading(true);
          setImageKey((prev) => prev + 1);
        } else if (e.key === 'ArrowRight' || e.key === '.') {
          e.preventDefault();
          setCurrentSlice((prev) => (prev < maxSlice ? prev + 1 : 0));
          setLoading(true);
          setImageKey((prev) => prev + 1);
        } else if (e.key === ' ') {
          e.preventDefault();
          setIsPlaying((prev) => !prev);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setCurrentSlice(0);
          setLoading(true);
          setImageKey((prev) => prev + 1);
        } else if (e.key === 'End') {
          e.preventDefault();
          setCurrentSlice(maxSlice);
          setLoading(true);
          setImageKey((prev) => prev + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    onClose,
    cubeInfo?.is_cube,
    cubeInfo?.n_slices,
    annotations,
    annotationTool,
    handleAnnotationDelete,
    handleAnnotationSelect,
  ]);

  // Zoom handlers
  const handleZoomIn = () => setScale((s) => Math.min(s * 1.2, 10));
  const handleZoomOut = () => setScale((s) => Math.max(s / 1.2, 0.1));
  const handleReset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.1, Math.min(10, s * delta)));
  }, []);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (annotationTool) return; // Don't pan in annotation mode
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  // Animation frame ref for throttling cursor updates
  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle panning when dragging
      if (isDragging) {
        e.preventDefault();
        setOffset({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
        return;
      }

      // Handle cursor tracking for coordinate display when not dragging
      if (!pixels || !pixelData || !imageRef.current) return;

      // Throttle updates using requestAnimationFrame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!imageRef.current || !pixels || !pixelData) return;

        // Get mouse position relative to the image element
        const rect = imageRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate cursor info using the utility function
        const info = calculateCursorInfo(
          mouseX,
          mouseY,
          rect.width,
          rect.height,
          scale,
          offset.x,
          offset.y,
          pixelData.preview_shape[1], // width
          pixelData.preview_shape[0], // height
          pixelData.scale_factor,
          pixels,
          pixelData.wcs
        );

        setCursorInfo(info);
      });
    },
    [isDragging, dragStart, pixels, pixelData, scale, offset]
  );

  const handleMouseUp = () => setIsDragging(false);

  const handleMouseLeave = useCallback(() => {
    // Clear cursor info when mouse leaves the viewport
    setCursorInfo(null);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Extract useful metadata for display
  const getDisplayMetadata = () => {
    if (!metadata && !imageInfo) return {};
    const display: Record<string, string> = {};

    // Priority fields to show from mast_* metadata
    const priorityFields = [
      'mast_obs_id',
      'mast_target_name',
      'mast_instrument_name',
      'mast_filters',
      'mast_t_exptime',
      'mast_calib_level',
      'mast_proposal_id',
      'mast_obs_title',
    ];

    if (metadata) {
      for (const field of priorityFields) {
        if (metadata[field] !== undefined && metadata[field] !== null) {
          const label = field.replace('mast_', '').replace(/_/g, ' ').toUpperCase();
          display[label] = String(metadata[field]);
        }
      }
    }

    // Fall back to imageInfo fields when mast_* keys are absent
    if (imageInfo && Object.keys(display).length === 0) {
      if (imageInfo.targetName) display['TARGET NAME'] = imageInfo.targetName;
      if (imageInfo.instrument) display['INSTRUMENT NAME'] = imageInfo.instrument;
      if (imageInfo.filter) display['FILTERS'] = imageInfo.filter;
      if (imageInfo.exposureTime !== undefined)
        display['EXPOSURE TIME'] = String(imageInfo.exposureTime);
      if (imageInfo.calibrationLevel !== undefined)
        display['CALIB LEVEL'] = String(imageInfo.calibrationLevel);
      if (imageInfo.proposalId) display['PROPOSAL ID'] = imageInfo.proposalId;
      if (imageInfo.observationTitle) display['OBS TITLE'] = imageInfo.observationTitle;
    }

    return display;
  };

  // Handle region selection complete
  const handleRegionComplete = useCallback(
    async (regionType: RegionType, rectangle?: RectangleRegion, ellipse?: EllipseRegion) => {
      setShowRegionStats(true);
      setRegionStatsLoading(true);
      setRegionStatsError(null);
      setRegionStats(null);

      try {
        const result = await getRegionStatistics({
          dataId,
          regionType,
          rectangle,
          ellipse,
        });
        setRegionStats(result);
      } catch (err) {
        setRegionStatsError(
          err instanceof Error ? err.message : 'Failed to compute region statistics'
        );
      } finally {
        setRegionStatsLoading(false);
      }
    },
    [dataId]
  );

  const handleClearRegion = useCallback(() => {
    setRegionMode(null);
    setRegionStats(null);
    setRegionStatsError(null);
    setShowRegionStats(false);
  }, []);

  // Track whether curves are non-identity (controls canvas visibility)
  useEffect(() => {
    setCurvesActive(!isIdentityCurve(curvePoints));
  }, [curvePoints]);

  // Apply curves LUT to overlay canvas when active
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;

    // Clear canvas when curves are inactive
    if (!curvesActive) {
      overlayCanvas.width = 0;
      overlayCanvas.height = 0;
      return;
    }

    const img = imageRef.current;
    if (!img || !blobUrl || loading) return;

    // Guard: image must be fully decoded with valid dimensions
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      console.warn('[Curves] Image not ready — skipping LUT apply', {
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
      return;
    }

    try {
      const lut = generateLUT(curvePoints);
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;

      overlayCanvas.width = img.naturalWidth;
      overlayCanvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      if (overlayCanvas.width === 0 || overlayCanvas.height === 0) {
        console.warn('[Curves] Canvas has zero dimensions — skipping LUT apply');
        return;
      }

      const imageData = ctx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
      applyLUT(imageData, lut);
      ctx.putImageData(imageData, 0, 0);
    } catch (err) {
      console.error('[Curves] Failed to apply LUT to overlay canvas:', err);
    }
  }, [curvesActive, curvePoints, blobUrl, loading]);

  // Curves control point change handler
  const handleCurvePointsChange = useCallback((newPoints: CurveControlPoint[]) => {
    setCurvePoints(newPoints);
    setCurvePreset(null);
  }, []);

  // Curves preset change handler
  const handleCurvePresetChange = useCallback((preset: CurvePresetName) => {
    const points = getPresetControlPoints(preset);
    setCurvePoints(points);
    setCurvePreset(preset);
  }, []);

  // Curves reset handler
  const handleCurvesReset = useCallback(() => {
    setCurvePoints(getDefaultControlPoints());
    setCurvePreset('linear');
  }, []);

  // Handle export with options (PNG or JPEG)
  const handleExport = async (options: ExportOptions) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exportUrl =
        `${API_BASE_URL}/api/jwstdata/${dataId}/preview?` +
        `cmap=${colormap}` +
        `&width=${options.width}` +
        `&height=${options.height}` +
        `&stretch=${stretchParams.stretch}` +
        `&gamma=${stretchParams.gamma}` +
        `&blackPoint=${stretchParams.blackPoint}` +
        `&whitePoint=${stretchParams.whitePoint}` +
        `&asinhA=${stretchParams.asinhA}` +
        `&format=${options.format}` +
        `&quality=${options.quality}` +
        `&embedAvm=${options.embedAvm}`;

      const token = localStorage.getItem('jwst_auth_token');
      const response = await fetch(exportUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Export failed: ${response.status}`);

      const blob = await response.blob();
      const filename = generateExportFilename(metadata, title, options.format, imageInfo);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      setShowExportOptions(false);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const displayMeta = getDisplayMetadata();
  const targetName =
    (metadata?.mast_target_name as string) || imageInfo?.targetName || 'Unknown Target';
  const instrument = (metadata?.mast_instrument_name as string) || imageInfo?.instrument || 'JWST';
  const filter = (metadata?.mast_filters as string) || imageInfo?.filter || '';
  const obsTitle = (metadata?.mast_obs_title as string) || imageInfo?.observationTitle || '';

  if (!isOpen || !isValidObjectId(dataId)) return null;

  return (
    <div className="image-viewer-overlay" onClick={onClose}>
      <div className="image-viewer-container advanced-mode" onClick={(e) => e.stopPropagation()}>
        <div
          className={`advanced-fits-viewer-grid ${metadataCollapsed ? 'sidebar-collapsed' : ''} ${isCompactLayout ? 'compact-layout' : ''}`}
        >
          {/* Main Content Area */}
          <main className="viewer-main-content">
            {/* Header */}
            <header className="viewer-header">
              <div className="header-left">
                <button onClick={onClose} className="btn-icon" title="Go Back">
                  <Icons.Back />
                </button>
                <div className="header-title-block">
                  {obsTitle && <h1 className="header-obs-title">{obsTitle}</h1>}
                  <div className="header-breadcrumbs">
                    <span className="breadcrumb-item">{targetName}</span>
                    <span className="breadcrumb-separator">/</span>
                    <span className="breadcrumb-item">{instrument}</span>
                    {filter && (
                      <>
                        <span className="breadcrumb-separator">/</span>
                        <span className="breadcrumb-item active">{filter}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="header-right">
                {onCompare && (
                  <button
                    className="btn-icon"
                    title="Compare with another image"
                    onClick={onCompare}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="3" width="8" height="18" rx="1" />
                      <rect x="14" y="3" width="8" height="18" rx="1" />
                    </svg>
                  </button>
                )}
                <div className="region-tools">
                  <button
                    className={`btn-icon btn-sm ${regionMode === 'rectangle' ? 'active' : ''}`}
                    title="Rectangle Region"
                    onClick={() => {
                      setRegionMode(regionMode === 'rectangle' ? null : 'rectangle');
                      setAnnotationTool(null);
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2" />
                    </svg>
                  </button>
                  <button
                    className={`btn-icon btn-sm ${regionMode === 'ellipse' ? 'active' : ''}`}
                    title="Ellipse Region"
                    onClick={() => {
                      setRegionMode(regionMode === 'ellipse' ? null : 'ellipse');
                      setAnnotationTool(null);
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <ellipse cx="12" cy="12" rx="10" ry="7" strokeDasharray="4 2" />
                    </svg>
                  </button>
                </div>
                <div className="annotation-tools">
                  <button
                    className={`btn-icon btn-sm ${annotationTool === 'text' ? 'active' : ''}`}
                    title="Text Label"
                    onClick={() => handleAnnotationToolChange('text')}
                  >
                    <Icons.TextTool />
                  </button>
                  <button
                    className={`btn-icon btn-sm ${annotationTool === 'arrow' ? 'active' : ''}`}
                    title="Arrow"
                    onClick={() => handleAnnotationToolChange('arrow')}
                  >
                    <Icons.ArrowTool />
                  </button>
                  <button
                    className={`btn-icon btn-sm ${annotationTool === 'circle' ? 'active' : ''}`}
                    title="Circle / Ellipse"
                    onClick={() => handleAnnotationToolChange('circle')}
                  >
                    <Icons.CircleTool />
                  </button>
                  {annotationTool && (
                    <div className="annotation-color-picker">
                      {ANNOTATION_COLORS.map((c) => (
                        <button
                          key={c.value}
                          className={`annotation-color-swatch ${annotationColor === c.value ? 'active' : ''}`}
                          style={{ backgroundColor: c.value }}
                          title={c.label}
                          onClick={() => setAnnotationColor(c.value)}
                        />
                      ))}
                    </div>
                  )}
                  {annotations.length > 0 && (
                    <button
                      className="btn-icon btn-sm"
                      title="Clear All Annotations"
                      onClick={handleAnnotationClearAll}
                    >
                      <Icons.Trash />
                    </button>
                  )}
                </div>
                <div className="export-button-container">
                  <button
                    className={`btn-icon ${showExportOptions ? 'active' : ''}`}
                    title="Export Image"
                    onClick={() => setShowExportOptions(!showExportOptions)}
                    disabled={loading}
                  >
                    <Icons.Export />
                  </button>
                  {showExportOptions && (
                    <div className="export-panel-dropdown">
                      <ExportOptionsPanel
                        onExport={handleExport}
                        onClose={() => setShowExportOptions(false)}
                        isExporting={isExporting}
                        disabled={loading}
                      />
                    </div>
                  )}
                </div>
                <button
                  className="btn-icon"
                  title="Download FITS"
                  onClick={() =>
                    window.open(`${API_BASE_URL}/api/jwstdata/${dataId}/file`, '_blank')
                  }
                >
                  <Icons.Download />
                </button>
              </div>
            </header>

            {/* Image Viewport */}
            <div
              className="canvas-viewport"
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                handleMouseUp();
                handleMouseLeave();
              }}
              onWheel={handleWheel}
            >
              {loading && (
                <div className="viewer-loading-state">
                  <div className="spinner"></div>
                  <span>Generating preview...</span>
                </div>
              )}

              {error && <div className="viewer-error-state">{error}</div>}

              <img
                ref={imageRef}
                src={blobUrl || ''}
                alt={`Preview of ${title}`}
                className="scientific-canvas"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  display: loading || !blobUrl ? 'none' : 'block',
                  opacity: curvesActive ? 0 : 1,
                  pointerEvents: curvesActive ? 'none' : 'auto',
                  maxWidth: 'none',
                  maxHeight: 'none',
                }}
                onError={() => {
                  setError(
                    'Failed to generate preview. The file may not contain viewable image data.'
                  );
                  setLoading(false);
                  pendingAdvanceRef.current = false; // Stop playback on error
                }}
                onLoad={() => {
                  setLoading(false);
                  handleImageLoadForPlayback();
                }}
                draggable={false}
              />

              {/* Curves LUT overlay canvas — always mounted so ref is stable for useEffect */}
              <canvas
                ref={overlayCanvasRef}
                className="scientific-canvas curves-overlay-canvas"
                style={{
                  position: 'absolute',
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  display: curvesActive && !loading && blobUrl ? 'block' : 'none',
                }}
                draggable={false}
              />

              {/* WCS Grid Overlay */}
              <WcsGridOverlay
                wcs={pixelData?.wcs ?? null}
                imageWidth={pixelData?.preview_shape?.[1] ?? 0}
                imageHeight={pixelData?.preview_shape?.[0] ?? 0}
                scaleFactor={pixelData?.scale_factor ?? 1}
                imageElement={imageRef.current}
                visible={showWcsGrid}
                zoomScale={scale}
              />

              {/* Region Selection Overlay */}
              <RegionSelector
                mode={regionMode}
                onRegionComplete={handleRegionComplete}
                onClear={handleClearRegion}
                imageDataWidth={pixelData?.preview_shape?.[1] ?? 1000}
                imageDataHeight={pixelData?.preview_shape?.[0] ?? 1000}
                imageElement={imageRef.current}
                scale={scale}
                offset={offset}
              />

              {/* Annotation Overlay */}
              <AnnotationOverlay
                activeTool={annotationTool}
                annotations={annotations}
                activeColor={annotationColor}
                onAnnotationAdd={handleAnnotationAdd}
                onAnnotationSelect={handleAnnotationSelect}
                imageDataWidth={pixelData?.preview_shape?.[1] ?? 1000}
                imageDataHeight={pixelData?.preview_shape?.[0] ?? 1000}
                imageElement={imageRef.current}
              />

              {/* Floating Toolbar */}
              <div className="viewer-floating-toolbar">
                <div className="toolbar-group">
                  <button onClick={handleZoomOut} className="btn-icon" title="Zoom Out">
                    <Icons.ZoomOut />
                  </button>
                  <button onClick={handleReset} className="btn-text" title="Reset View">
                    {Math.round(scale * 100)}%
                  </button>
                  <button onClick={handleZoomIn} className="btn-icon" title="Zoom In">
                    <Icons.ZoomIn />
                  </button>
                </div>

                <div className="toolbar-divider" />

                <div className="toolbar-group">
                  <div className="fits-select-wrapper">
                    <Icons.Palette />
                    <select
                      value={colormap}
                      onChange={(e) => handleColormapChange(e.target.value)}
                      className="fits-select"
                    >
                      {COLORMAPS.map((cm) => (
                        <option key={cm.value} value={cm.value}>
                          {cm.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="toolbar-divider" />

                <div className="toolbar-group">
                  <button
                    className={`btn-icon btn-sm ${showWcsGrid ? 'active' : ''}`}
                    title={pixelData?.wcs ? 'Toggle WCS Grid' : 'WCS not available'}
                    onClick={() => setShowWcsGrid(!showWcsGrid)}
                    disabled={!pixelData?.wcs}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="4" y1="4" x2="4" y2="20" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                      <line x1="20" y1="4" x2="20" y2="20" />
                      <line x1="4" y1="4" x2="20" y2="4" />
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <line x1="4" y1="20" x2="20" y2="20" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Floating panels container - stacks below header */}
              <div className="viewer-floating-panels">
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseMove={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  <StretchControls
                    params={pendingStretchParams}
                    onChange={handleStretchParamsChange}
                    collapsed={stretchControlsCollapsed}
                    onToggleCollapse={() => setStretchControlsCollapsed(!stretchControlsCollapsed)}
                  />
                </div>

                {/* 3D Cube Navigator - only shown for data cubes */}
                {cubeInfo?.is_cube && cubeInfo.n_slices > 1 && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseMove={(e) => e.stopPropagation()}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <CubeNavigator
                      cubeInfo={cubeInfo}
                      currentSlice={currentSlice}
                      onSliceChange={handleSliceChange}
                      isPlaying={isPlaying}
                      onPlayPause={handlePlayPause}
                      playbackSpeed={playbackSpeed}
                      onPlaybackSpeedChange={handlePlaybackSpeedChange}
                      collapsed={cubeNavigatorCollapsed}
                      onToggleCollapse={() => setCubeNavigatorCollapsed(!cubeNavigatorCollapsed)}
                    />
                  </div>
                )}

                {/* Stretched Histogram Panel - markers at 0/1 edges, drag maps to current range */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseMove={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  <HistogramPanel
                    histogram={histogramData}
                    blackPoint={pendingStretchParams.blackPoint}
                    whitePoint={pendingStretchParams.whitePoint}
                    viewDomain={zoomedDomain}
                    onBlackPointChange={handleStretchedBlackPointChange}
                    onWhitePointChange={handleStretchedWhitePointChange}
                    onDragEnd={handleStretchedDragEnd}
                    loading={histogramLoading}
                    collapsed={stretchedHistogramCollapsed}
                    onToggleCollapse={() =>
                      setStretchedHistogramCollapsed(!stretchedHistogramCollapsed)
                    }
                    title="Stretched (Zoomed View)"
                    showControls={true}
                    barColor="#4cc9f0"
                  />
                </div>

                {/* Raw Histogram Panel - with black/white point controls */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseMove={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  <HistogramPanel
                    histogram={rawHistogramData}
                    percentiles={histogramPercentiles}
                    stats={histogramStats}
                    blackPoint={pendingStretchParams.blackPoint}
                    whitePoint={pendingStretchParams.whitePoint}
                    onBlackPointChange={handleHistogramBlackPointChange}
                    onWhitePointChange={handleHistogramWhitePointChange}
                    loading={histogramLoading}
                    collapsed={rawHistogramCollapsed}
                    onToggleCollapse={() => setRawHistogramCollapsed(!rawHistogramCollapsed)}
                    title="Raw Data"
                    showControls={true}
                    barColor="rgba(255, 255, 255, 0.5)"
                  />
                </div>

                {/* Curves Adjustment Panel */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseMove={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  <CurvesEditor
                    controlPoints={curvePoints}
                    onChange={handleCurvePointsChange}
                    activePreset={curvePreset}
                    onPresetChange={handleCurvePresetChange}
                    onReset={handleCurvesReset}
                    collapsed={curvesCollapsed}
                    onToggleCollapse={() => setCurvesCollapsed(!curvesCollapsed)}
                  />
                </div>
              </div>

              {/* Region Statistics Panel */}
              {showRegionStats && (
                <div className="floating-panel region-stats-floating-panel">
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseMove={(e) => e.stopPropagation()}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <RegionStatisticsPanel
                      stats={regionStats}
                      loading={regionStatsLoading}
                      error={regionStatsError}
                      onClear={handleClearRegion}
                      collapsed={regionStatsCollapsed}
                      onToggleCollapse={() => setRegionStatsCollapsed(!regionStatsCollapsed)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Status Bar - Pixel Coordinate Display (below viewport) */}
            <div className="viewer-status-bar">
              {pixelDataLoading ? (
                <div className="status-bar-loading">
                  <div className="mini-spinner"></div>
                  <span>Loading pixel data...</span>
                </div>
              ) : cursorInfo ? (
                <>
                  <div className="status-bar-section">
                    <span className="status-bar-label">Pixel</span>
                    <span className="status-bar-value">
                      ({cursorInfo.fitsX}, {cursorInfo.fitsY})
                    </span>
                  </div>
                  <div className="status-bar-divider" />
                  <div className="status-bar-section">
                    <span className="status-bar-label">Value</span>
                    <span className="status-bar-value">
                      {formatPixelValue(cursorInfo.value, pixelData?.units)}
                    </span>
                  </div>
                  {cursorInfo.ra !== undefined && cursorInfo.dec !== undefined && (
                    <>
                      <div className="status-bar-divider" />
                      <div className="status-bar-section">
                        <span className="status-bar-label">RA</span>
                        <span className="status-bar-value">{formatRA(cursorInfo.ra)}</span>
                      </div>
                      <div className="status-bar-divider" />
                      <div className="status-bar-section">
                        <span className="status-bar-label">Dec</span>
                        <span className="status-bar-value">{formatDec(cursorInfo.dec)}</span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <span className="status-bar-placeholder">Hover over image for coordinates</span>
              )}
            </div>
          </main>

          {/* Sidebar */}
          <aside className={`viewer-sidebar ${metadataCollapsed ? 'collapsed' : ''}`}>
            <div
              className="sidebar-header"
              onClick={() => setMetadataCollapsed(!metadataCollapsed)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setMetadataCollapsed(!metadataCollapsed);
                }
              }}
              aria-expanded={!metadataCollapsed}
              aria-label={metadataCollapsed ? 'Expand metadata panel' : 'Collapse metadata panel'}
            >
              <h3>Metadata</h3>
              <span className="sidebar-collapse-icon">
                {metadataCollapsed ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
              </span>
            </div>
            {metadataCollapsed && <span className="sidebar-collapsed-label">Metadata</span>}
            {!metadataCollapsed && (
              <div className="sidebar-content">
                {Object.keys(displayMeta).length > 0 ? (
                  <div className="metadata-grid">
                    <div className="metadata-row">
                      <span className="meta-key">FILENAME</span>
                      <span className="meta-value" title={title}>
                        {title}
                      </span>
                    </div>
                    {Object.entries(displayMeta).map(([key, value]) => (
                      <div key={key} className="metadata-row">
                        <span className="meta-key">{key}</span>
                        <span className="meta-value" title={value}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="metadata-empty">No metadata available</div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ImageViewer;
