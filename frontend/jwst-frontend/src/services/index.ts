/**
 * Re-export all services for clean imports
 *
 * Usage:
 *   import { jwstDataService, mastService, authService, ApiError } from '../services';
 */

export {
  apiClient,
  ApiClient,
  setTokenGetter,
  clearTokenGetter,
  setTokenRefresher,
  clearTokenRefresher,
  attemptTokenRefresh,
  ensureTokenFresh,
  getAuthLogs,
  printAuthLogs,
} from './apiClient';
export { ApiError } from './ApiError';
export { jwstDataService } from './jwstDataService';
export { mastService } from './mastService';
export { authService, AuthService } from './authService';
export * as compositeService from './compositeService';
export * as mosaicService from './mosaicService';
export * as analysisService from './analysisService';

// Re-export types
export type { UploadResponse } from './jwstDataService';
export type {
  SearchByTargetParams,
  SearchByCoordinatesParams,
  SearchByObservationParams,
  SearchByProgramParams,
  StartImportParams,
  DownloadSource,
} from './mastService';
