import { describe, it, expect } from 'vitest';

describe('services barrel export', () => {
  it('exports key services and utilities', async () => {
    const services = await import('./index');
    expect(services.apiClient).toBeDefined();
    expect(services.ApiError).toBeDefined();
    expect(services.jwstDataService).toBeDefined();
    expect(services.mastService).toBeDefined();
    expect(services.authService).toBeDefined();
    expect(services.compositeService).toBeDefined();
    expect(services.mosaicService).toBeDefined();
    expect(services.analysisService).toBeDefined();
  });
});
