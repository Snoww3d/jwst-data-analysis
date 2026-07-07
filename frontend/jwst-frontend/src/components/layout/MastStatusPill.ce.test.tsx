import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MastStatusPill } from './MastStatusPill';

// CE de-jargon: strangers don't know what "MAST" is
vi.mock('../../config/ce', () => ({ CE_MODE: true }));
vi.mock('../../services/healthService', () => ({
  checkHealth: vi.fn().mockResolvedValue({ status: 'Healthy', checks: [] }),
}));

describe('MastStatusPill in CE mode', () => {
  it('labels the pill "Archive" with an explanatory tooltip', async () => {
    render(<MastStatusPill />);
    const pill = await screen.findByRole('status');
    expect(pill).toHaveTextContent(/Archive/);
    expect(pill).not.toHaveTextContent(/MAST ·/);
    expect(pill).toHaveAttribute('title', expect.stringContaining('MAST'));
  });
});
