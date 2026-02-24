import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicSelectStep } from './MosaicSelectStep';

vi.mock('../../config/api', () => ({
  API_BASE_URL: 'http://test',
}));

vi.mock('./FootprintPreview', () => ({
  default: () => <div data-testid="footprint-preview" />,
  FootprintPreview: () => <div data-testid="footprint-preview" />,
}));

describe('MosaicSelectStep', () => {
  const defaultProps = {
    allImages: [],
    selectedIds: new Set<string>(),
    onSelectionChange: vi.fn(),
    maxFileSizeBytes: null,
    footprintData: null,
    footprintLoading: false,
    footprintError: null,
    onRetryFootprints: vi.fn(),
  };

  it('renders the step with search and filter controls', () => {
    render(<MosaicSelectStep {...defaultProps} />);
    // The step should render without crashing
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });
});
