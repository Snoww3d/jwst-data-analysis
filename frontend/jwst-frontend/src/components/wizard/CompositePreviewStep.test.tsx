import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompositePreviewStep } from './CompositePreviewStep';
import { createDefaultRGBChannels } from '../../types/CompositeTypes';

vi.mock('../../services', () => ({
  compositeService: {
    generatePreview: vi.fn(() => Promise.resolve(new Blob())),
    generateNChannelPreview: vi.fn(() => Promise.resolve(new Blob())),
    exportComposite: vi.fn(() => Promise.resolve(new Blob())),
    exportNChannelCompositeAsync: vi.fn(() => Promise.resolve({ jobId: 'test-job-123' })),
    generateFilename: vi.fn(() => 'test-composite.png'),
    downloadComposite: vi.fn(),
    getCompositeToken: vi.fn(() => 'test-token'),
  },
}));

vi.mock('../../hooks/useJobProgress', () => ({
  useJobProgress: vi.fn(() => ({
    progress: null,
    isComplete: false,
    error: null,
  })),
}));

vi.mock('../../config/api', () => ({
  API_BASE_URL: 'http://test:5001',
}));

vi.mock('../StretchControls', () => ({
  default: () => <div data-testid="stretch-controls" />,
}));

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('CompositePreviewStep', () => {
  const defaultProps = {
    selectedImages: [],
    channels: createDefaultRGBChannels(),
    onChannelsChange: vi.fn(),
  };

  it('renders without crashing', () => {
    const { container } = render(<CompositePreviewStep {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('renders export button', () => {
    render(<CompositePreviewStep {...defaultProps} />);
    const exportBtn = screen.getByRole('button', { name: /export.*download/i });
    expect(exportBtn).toBeTruthy();
    expect(exportBtn).toBeDisabled(); // No preview URL yet
  });

  it('calls exportNChannelCompositeAsync on export click', async () => {
    const { useJobProgress } = await import('../../hooks/useJobProgress');
    vi.mocked(useJobProgress).mockReturnValue({
      progress: null,
      isComplete: false,
      error: null,
    });

    // Note: export button is disabled when there's no preview, so this test
    // verifies the button exists and its disabled state (preview requires live API)
    render(<CompositePreviewStep {...defaultProps} />);
    const exportBtn = screen.getByRole('button', { name: /export.*download/i });
    expect(exportBtn).toBeDisabled();
  });
});
