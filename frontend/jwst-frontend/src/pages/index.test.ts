import { describe, it, expect } from 'vitest';

describe('pages barrel export', () => {
  // Pulls in every page module at once, so it is by far the heaviest import in
  // the suite; the 5s default started timing out under full-suite parallelism
  // once the calibration pages joined the barrel (#1733).
  it('exports all page components', { timeout: 20000 }, async () => {
    const pages = await import('./index');
    expect(pages.LoginPage).toBeDefined();
    expect(pages.RegisterPage).toBeDefined();
    expect(pages.DiscoveryHome).toBeDefined();
    expect(pages.MyLibrary).toBeDefined();
    expect(pages.TargetDetail).toBeDefined();
    expect(pages.GuidedCreate).toBeDefined();
    expect(pages.CompositePage).toBeDefined();
    expect(pages.MosaicPage).toBeDefined();
  });
});
