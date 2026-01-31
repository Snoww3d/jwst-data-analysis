/**
 * Centralized API configuration
 *
 * The base URL can be overridden via the VITE_API_URL environment variable.
 * Default: http://localhost:5001 (development)
 *
 * Usage:
 *   import { API_BASE_URL } from '../config/api';
 *   const response = await fetch(`${API_BASE_URL}/api/jwstdata`);
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
