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
  Unknown: 'unknown'
} as const;

export type ProcessingLevel = typeof ProcessingLevels[keyof typeof ProcessingLevels];

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
  'L1': 'Level 1 (Raw)',
  'L2a': 'Level 2a (Rate)',
  'L2b': 'Level 2b (Calibrated)',
  'L3': 'Level 3 (Combined)',
  'unknown': 'Unknown'
};

// Helper for level colors
export const ProcessingLevelColors: Record<string, string> = {
  'L1': '#ef4444',   // red
  'L2a': '#f59e0b',  // amber
  'L2b': '#10b981',  // emerald
  'L3': '#3b82f6',   // blue
  'unknown': '#6b7280' // gray
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