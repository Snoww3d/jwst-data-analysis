import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicWizard } from './MosaicWizard';

vi.mock('../services/mosaicService', () => ({
  getLimits: vi.fn(() => Promise.resolve({ mosaicMaxFileSizeMB: 100 })),
  getFootprints: vi.fn(() => Promise.resolve({ footprints: [], bounding_box: {} })),
}));

vi.mock('./wizard/WizardStepper', () => ({
  default: () => <div data-testid="wizard-stepper" />,
}));

vi.mock('./wizard/MosaicSelectStep', () => ({
  default: () => <div data-testid="mosaic-select-step" />,
  MosaicSelectStep: () => <div data-testid="mosaic-select-step" />,
}));

vi.mock('./wizard/MosaicPreviewStep', () => ({
  default: () => <div data-testid="mosaic-preview-step" />,
  MosaicPreviewStep: () => <div data-testid="mosaic-preview-step" />,
}));

describe('MosaicWizard', () => {
  const defaultProps = {
    allImages: [],
    onClose: vi.fn(),
  };

  it('renders the wizard title', () => {
    render(<MosaicWizard {...defaultProps} />);
    expect(screen.getByText('WCS Mosaic Creator')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<MosaicWizard {...defaultProps} />);
    expect(screen.getByLabelText('Close wizard')).toBeInTheDocument();
  });

  it('renders step 1 content', () => {
    render(<MosaicWizard {...defaultProps} />);
    expect(screen.getByTestId('mosaic-select-step')).toBeInTheDocument();
  });

  it('renders Back and Next buttons', () => {
    render(<MosaicWizard {...defaultProps} />);
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });
});
