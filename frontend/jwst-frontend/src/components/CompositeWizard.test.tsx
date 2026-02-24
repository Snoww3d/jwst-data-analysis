import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompositeWizard } from './CompositeWizard';

vi.mock('./wizard/WizardStepper', () => ({
  default: () => <div data-testid="wizard-stepper" />,
}));

vi.mock('./wizard/ChannelAssignStep', () => ({
  default: () => <div data-testid="channel-assign-step" />,
  ChannelAssignStep: () => <div data-testid="channel-assign-step" />,
}));

vi.mock('./wizard/CompositePreviewStep', () => ({
  default: () => <div data-testid="composite-preview-step" />,
  CompositePreviewStep: () => <div data-testid="composite-preview-step" />,
}));

describe('CompositeWizard', () => {
  const defaultProps = {
    allImages: [],
    onClose: vi.fn(),
  };

  it('renders the wizard title', () => {
    render(<CompositeWizard {...defaultProps} />);
    expect(screen.getByText('Composite Creator')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<CompositeWizard {...defaultProps} />);
    expect(screen.getByLabelText('Close wizard')).toBeInTheDocument();
  });

  it('renders step 1 content', () => {
    render(<CompositeWizard {...defaultProps} />);
    expect(screen.getByTestId('channel-assign-step')).toBeInTheDocument();
  });

  it('renders Back and Next buttons', () => {
    render(<CompositeWizard {...defaultProps} />);
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });
});
