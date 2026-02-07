export interface JwstDataModel {
  id: string;
  fileName: string;
  dataType: string;
  uploadDate: string;
  description?: string;
  metadata: Record<string, any>;
  filePath?: string;
  fileSize: number;
  processingStatus: string;
  tags: string[];
  userId?: string;
  isArchived: boolean;
  archivedDate?: string;
  imageInfo?: ImageMetadata;
  sensorInfo?: SensorMetadata;
  processingResults: ProcessingResult[];
  // Lineage fields
  processingLevel?: string;
  observationBaseId?: string;
  exposureId?: string;
  parentId?: string;
  derivedFrom?: string[];
  // Viewability
  isViewable?: boolean;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format?: string;
  bitDepth?: number;
  channels?: string[];
  statistics?: Record<string, number>;
  // Astronomical fields
  targetName?: string;
  wavelength?: string;
  filter?: string;
  instrument?: string;
  observationDate?: string;
  exposureTime?: number;
  coordinateSystem?: string;
  wcs?: Record<string, number>;
  units?: string;
  // MAST-specific fields
  wavelengthRange?: string;
  calibrationLevel?: number;
  proposalId?: string;
  proposalPi?: string;
  observationTitle?: string;
}

export interface SensorMetadata {
  instrument?: string;
  wavelength?: string;
  dataPoints?: number;
  units?: string;
  observationDate?: string;
  instrumentSettings?: Record<string, any>;
}

export interface ProcessingResult {
  id: string;
  algorithm: string;
  processedDate: string;
  status: string;
  parameters: Record<string, any>;
  results: Record<string, any>;
  outputFilePath?: string;
  errorMessage?: string;
}

export interface ProcessingRequest {
  algorithm: string;
  parameters: Record<string, any>;
}

// Processing level constants
export const ProcessingLevels = {
  L1: 'L1',
  L2a: 'L2a',
  L2b: 'L2b',
  L3: 'L3',
  Unknown: 'unknown',
} as const;

export type ProcessingLevel = (typeof ProcessingLevels)[keyof typeof ProcessingLevels];

// Lineage response types
export interface LineageResponse {
  observationBaseId: string;
  totalFiles: number;
  levelCounts: Record<string, number>;
  files: LineageFileInfo[];
}

export interface LineageFileInfo {
  id: string;
  fileName: string;
  processingLevel: string;
  dataType: string;
  parentId?: string;
  fileSize: number;
  uploadDate: string;
  targetName?: string;
  instrument?: string;
}

// Helper for display names
export const ProcessingLevelLabels: Record<string, string> = {
  L1: 'Level 1 (Raw)',
  L2a: 'Level 2a (Rate)',
  L2b: 'Level 2b (Calibrated)',
  L3: 'Level 3 (Combined)',
  unknown: 'Unknown',
};

// Helper for level colors
export const ProcessingLevelColors: Record<string, string> = {
  L1: '#ef4444', // red
  L2a: '#f59e0b', // amber
  L2b: '#10b981', // emerald
  L3: '#3b82f6', // blue
  unknown: '#6b7280', // gray
};

// Delete observation response
export interface DeleteObservationResponse {
  observationBaseId: string;
  fileCount: number;
  totalSizeBytes: number;
  fileNames: string[];
  deleted: boolean;
  message: string;
}

// Delete by processing level response
export interface DeleteLevelResponse {
  observationBaseId: string;
  processingLevel: string;
  fileCount: number;
  totalSizeBytes: number;
  fileNames: string[];
  deleted: boolean;
  message: string;
}

// Archive by processing level response
export interface ArchiveLevelResponse {
  observationBaseId: string;
  processingLevel: string;
  archivedCount: number;
  message: string;
}

// Bulk import response from /api/datamanagement/import/scan
export interface BulkImportResponse {
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  importedFiles: string[];
  skippedFiles: string[];
  errors: string[];
  message: string;
}

// Generic API error response
export interface ApiErrorResponse {
  error?: string;
  message?: string;
  details?: string;
}

// Metadata refresh response for all records
export interface MetadataRefreshAllResponse {
  obsId: string;
  updatedCount: number;
  message: string;
}

// WCS (World Coordinate System) parameters for coordinate transformation
export interface WCSParams {
  crpix1: number; // Reference pixel X
  crpix2: number; // Reference pixel Y
  crval1: number; // Reference RA (degrees)
  crval2: number; // Reference Dec (degrees)
  cdelt1: number; // Pixel scale X (degrees/pixel)
  cdelt2: number; // Pixel scale Y (degrees/pixel)
  cd1_1: number; // CD matrix element
  cd1_2: number; // CD matrix element
  cd2_1: number; // CD matrix element
  cd2_2: number; // CD matrix element
  ctype1: string; // Coordinate type X (e.g., "RA---TAN")
  ctype2: string; // Coordinate type Y (e.g., "DEC--TAN")
}

// Pixel data response from the API for hover coordinate display
export interface PixelDataResponse {
  data_id: string;
  original_shape: [number, number]; // [height, width]
  preview_shape: [number, number]; // [height, width]
  scale_factor: number;
  wcs: WCSParams | null;
  units: string;
  pixels: string; // Base64-encoded Float32Array
}

// Current cursor info for hover display
export interface CursorInfo {
  // Preview pixel coordinates (in the displayed image)
  previewX: number;
  previewY: number;
  // Original FITS pixel coordinates
  fitsX: number;
  fitsY: number;
  // Pixel value at this location
  value: number;
  // Sky coordinates (if WCS available)
  ra?: number;
  dec?: number;
}

// Export options for PNG/JPEG export
export type ExportFormat = 'png' | 'jpeg';

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 1-100 (only used for JPEG)
  width: number; // 10-8000 pixels
  height: number; // 10-8000 pixels
  embedAvm: boolean; // Embed AVM XMP metadata in exported image
}

// Resolution presets for export
export const ExportResolutionPresets = {
  standard: { width: 1200, height: 1200, label: 'Standard (1200px)' },
  high: { width: 2048, height: 2048, label: 'High (2048px)' },
  maximum: { width: 4096, height: 4096, label: 'Maximum (4096px)' },
  custom: { width: 0, height: 0, label: 'Custom' },
} as const;

export type ExportResolutionPreset = keyof typeof ExportResolutionPresets;

// 3D Data Cube types for cube navigator
export interface CubeAxis3Info {
  crval3: number; // Reference value for axis 3 (wavelength/frequency/time)
  cdelt3: number; // Increment per slice
  crpix3: number; // Reference pixel for axis 3
  cunit3: string; // Unit string (e.g., "um", "nm", "Hz")
  ctype3: string; // Axis type (e.g., "WAVE", "FREQ", "TIME")
}

export interface CubeInfoResponse {
  data_id: string;
  is_cube: boolean; // True if data has 3+ dimensions
  n_slices: number; // Number of slices along axis 3
  axis3: CubeAxis3Info | null; // WCS info for axis 3 (null if not available)
  slice_unit: string; // Human-readable unit (e.g., "um", "nm")
  slice_label: string; // Label for the axis (e.g., "Wavelength", "Frame")
}
