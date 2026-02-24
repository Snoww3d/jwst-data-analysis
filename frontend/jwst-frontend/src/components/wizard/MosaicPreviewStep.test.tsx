import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MosaicPreviewStep } from './MosaicPreviewStep';

vi.mock('../../services/ApiError', () => ({
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

vi.mock('../../services/mosaicService', () => ({
  generateMosaic: vi.fn(() => Promise.resolve({ url: 'test' })),
  saveMosaic: vi.fn(() => Promise.resolve({})),
}));

vi.mock('./FootprintPreview', () => ({
  default: () => <div data-testid="footprint-preview" />,
  FootprintPreview: () => <div data-testid="footprint-preview" />,
}));

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('MosaicPreviewStep', () => {
  const defaultProps = {
    selectedImages: [],
    selectedIds: [],
    footprintData: null,
    footprintLoading: false,
    footprintError: null,
    onRetryFootprints: vi.fn(),
  };

  it('renders without crashing', () => {
    const { container } = render(<MosaicPreviewStep {...defaultProps} />);
    expect(container).toBeTruthy();
  });
});
