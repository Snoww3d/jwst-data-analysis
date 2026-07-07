import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * CE_MODE is read from import.meta.env at module evaluation, so each case
 * stubs the env and re-imports the module fresh.
 */
describe('CE_MODE flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is false when VITE_CE_MODE is unset', async () => {
    vi.stubEnv('VITE_CE_MODE', undefined as unknown as string);
    const { CE_MODE } = await import('./ce');
    expect(CE_MODE).toBe(false);
  });

  it('is true only for the literal string "true"', async () => {
    vi.stubEnv('VITE_CE_MODE', 'true');
    vi.resetModules();
    expect((await import('./ce')).CE_MODE).toBe(true);
  });

  it.each(['1', 'TRUE', 'yes', ''])('is false for %j', async (value) => {
    vi.stubEnv('VITE_CE_MODE', value);
    vi.resetModules();
    expect((await import('./ce')).CE_MODE).toBe(false);
  });
});
