export interface MastTargetSearchRequest {
  targetName: string;
  radius?: number;
}

export interface MastCoordinateSearchRequest {
  ra: number;
  dec: number;
  radius?: number;
}

export interface MastObservationSearchRequest {
  obsId: string;
}

export interface MastProgramSearchRequest {
  programId: string;
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
