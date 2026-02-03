/**
 * Re-export all services for clean imports
 *
 * Usage:
 *   import { jwstDataService, mastService, authService, ApiError } from '../services';
 */

export { apiClient, ApiClient, setTokenGetter, clearTokenGetter } from './apiClient';
export { ApiError } from './ApiError';
export { jwstDataService } from './jwstDataService';
export { mastService } from './mastService';
export { authService, AuthService } from './authService';

// Re-export types
export type { ProcessingResponse, UploadResponse } from './jwstDataService';
export type {
  SearchByTargetParams,
  SearchByCoordinatesParams,
  SearchByObservationParams,
  SearchByProgramParams,
  StartImportParams,
} from './mastService';
