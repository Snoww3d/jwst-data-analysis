/**
 * Centralized API configuration
 *
 * The base URL can be overridden via the REACT_APP_API_URL environment variable.
 * Default: http://localhost:5001 (development)
 *
 * Usage:
 *   import { API_BASE_URL } from '../config/api';
 *   const response = await fetch(`${API_BASE_URL}/api/jwstdata`);
 */
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
