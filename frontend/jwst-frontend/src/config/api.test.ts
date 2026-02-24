/**
 * Unit tests for API config
 */

import { describe, it, expect } from 'vitest';
import { API_BASE_URL } from './api';

describe('api config', () => {
  it('should have default base URL when VITE_API_URL is not set', () => {
    expect(API_BASE_URL).toBe('http://localhost:5001');
  });

  it('should be a string', () => {
    expect(typeof API_BASE_URL).toBe('string');
  });

  it('should not end with a trailing slash', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false);
  });
});
