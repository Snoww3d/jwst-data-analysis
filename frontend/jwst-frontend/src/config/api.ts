/**
 * Centralized API configuration
 *
 * The base URL can be overridden via the VITE_API_URL environment variable.
 * - Development: http://localhost:5001 (default when not set)
 * - Staging/Production: empty string (requests go to same origin via nginx proxy)
 *
 * Usage:
 *   import { API_BASE_URL } from '../config/api';
 *   const response = await fetch(`${API_BASE_URL}/api/jwstdata`);
 */
const envApiUrl = import.meta.env.VITE_API_URL;
export const API_BASE_URL = envApiUrl !== undefined ? envApiUrl : 'http://localhost:5001';
