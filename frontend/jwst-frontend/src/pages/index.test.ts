import { describe, it, expect } from 'vitest';

describe('pages barrel export', () => {
  it('exports LoginPage and RegisterPage', async () => {
    const pages = await import('./index');
    expect(pages.LoginPage).toBeDefined();
    expect(pages.RegisterPage).toBeDefined();
  });
});
