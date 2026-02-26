import { describe, it, expect } from 'vitest';

describe('pages barrel export', () => {
  it('exports all page components', async () => {
    const pages = await import('./index');
    expect(pages.LoginPage).toBeDefined();
    expect(pages.RegisterPage).toBeDefined();
    expect(pages.DiscoveryHome).toBeDefined();
    expect(pages.MyLibrary).toBeDefined();
    expect(pages.TargetDetail).toBeDefined();
    expect(pages.GuidedCreate).toBeDefined();
  });
});
