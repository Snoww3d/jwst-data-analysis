export interface MastTargetSearchRequest {
  targetName: string;
  radius?: number;
  calibLevel?: number[];
}

export interface MastCoordinateSearchRequest {
  ra: number;
  dec: number;
  radius?: number;
  calibLevel?: number[];
}

export interface MastObservationSearchRequest {
  obsId: string;
  calibLevel?: number[];
}

export interface MastProgramSearchRequest {
  programId: string;
  calibLevel?: number[];
}

export interface MastRecentReleasesRequest {
  daysBack?: number;
  instrument?: string; // NIRCAM, MIRI, NIRSPEC, NIRISS
  limit?: number;
  offset?: number;
}

export interface MastSearchResponse {
  search_type: string;
  query_params: Record<string, unknown>;
  results: MastObservationResult[];
  result_count: number;
  timestamp: string;
}

export interface MastObservationResult {
  obs_id?: string;
  target_name?: string;
  s_ra?: number;
  s_dec?: number;
  instrument_name?: string;
  filters?: string;
  t_exptime?: number;
  dataproduct_type?: string;
  calib_level?: number;
  t_min?: number; // Observation start time (MJD)
  t_max?: number; // Observation end time (MJD)
  t_obs_release?: number; // Data release date (MJD)
  proposal_id?: string;
  proposal_pi?: string;
  obs_collection?: string;
  jpegURL?: string; // Preview thumbnail URL from MAST
  [key: string]: unknown;
}

export interface MastImportRequest {
  obsId: string;
  productType?: string;
  userId?: string;
  tags?: string[];
  isPublic?: boolean;
}

export interface MastImportResponse {
  status: string;
  obsId: string;
  importedDataIds: string[];
  importedCount: number;
  error?: string;
  timestamp: string;
}

export interface MastDataProduct {
  productId?: string;
  fileName?: string;
  productType?: string;
  description?: string;
  size?: number;
  dataUri?: string;
}

export interface MastDataProductsResponse {
  obs_id: string;
  products: MastDataProduct[];
  product_count: number;
}

export type MastSearchType = 'target' | 'coordinates' | 'observation' | 'program';

// Import Job Progress Types
export interface ImportJobStartResponse {
  jobId: string;
  obsId: string;
  message: string;
}

// File-level progress tracking
export interface FileProgressInfo {
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  progressPercent: number;
  status: string; // pending, downloading, complete, failed, paused
}

export interface ImportJobStatus {
  jobId: string;
  obsId: string;
  progress: number; // 0-100
  stage: string;
  message: string;
  isComplete: boolean;
  error?: string;
  startedAt: string;
  completedAt?: string;
  result?: MastImportResponse;
  // Byte-level progress tracking
  totalBytes?: number;
  downloadedBytes?: number;
  downloadProgressPercent?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  fileProgress?: FileProgressInfo[];
  isResumable?: boolean;
  downloadJobId?: string;
}

export const ImportStages = {
  Starting: 'Starting',
  Downloading: 'Downloading',
  SavingRecords: 'Saving records',
  Complete: 'Complete',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
} as const;

// Resumable job summary
export interface ResumableJobSummary {
  jobId: string;
  obsId: string;
  totalBytes: number;
  downloadedBytes: number;
  progressPercent: number;
  status: string;
  totalFiles: number;
  completedFiles: number;
  startedAt?: string;
}

export interface ResumableJobsResponse {
  jobs: ResumableJobSummary[];
  count: number;
}

// Metadata refresh response
export interface MetadataRefreshResponse {
  obsId: string;
  updatedCount: number;
  message: string;
}

/**
 * Status of a bulk import operation (multiple observations)
 */
export interface BulkImportStatus {
  /** All jobs being tracked, keyed by observation ID */
  jobs: Map<string, ImportJobStatus>;
  /** Observation IDs still pending (not started) */
  pendingObsIds: string[];
  /** Total number of observations in this bulk import */
  totalCount: number;
  /** Number completed successfully */
  completedCount: number;
  /** Number failed */
  failedCount: number;
  /** Whether the bulk import is still active */
  isActive: boolean;
}
