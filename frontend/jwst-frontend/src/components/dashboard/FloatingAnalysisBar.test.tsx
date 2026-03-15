import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloatingAnalysisBar from './FloatingAnalysisBar';

describe('FloatingAnalysisBar', () => {
  const defaultProps = {
    visible: true,
    selectedCount: 0,
    onOpenCompositeWizard: vi.fn(),
    onOpenMosaicWizard: vi.fn(),
    onOpenComparisonPicker: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has visible class when visible=true', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} visible={true} />);

    const bar = container.querySelector('.floating-analysis-bar');
    expect(bar).toHaveClass('visible');
  });

  it('does not have visible class when visible=false', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} visible={false} />);

    const bar = container.querySelector('.floating-analysis-bar');
    expect(bar).not.toHaveClass('visible');
  });

  it('shows selected count in button text when > 0', () => {
    render(<FloatingAnalysisBar {...defaultProps} selectedCount={5} />);

    expect(screen.getByText(/Composite \(5\)/)).toBeInTheDocument();
    expect(screen.getByText(/WCS Mosaic \(5\)/)).toBeInTheDocument();
  });

  it('does not show count in button text when selectedCount is 0', () => {
    render(<FloatingAnalysisBar {...defaultProps} selectedCount={0} />);

    // Buttons should just say "Composite" and "WCS Mosaic" without counts
    expect(screen.getByText('Composite')).toBeInTheDocument();
    expect(screen.getByText('WCS Mosaic')).toBeInTheDocument();
  });

  it('calls correct handlers on button clicks', () => {
    const onOpenCompositeWizard = vi.fn();
    const onOpenMosaicWizard = vi.fn();
    const onOpenComparisonPicker = vi.fn();

    render(
      <FloatingAnalysisBar
        {...defaultProps}
        selectedCount={3}
        onOpenCompositeWizard={onOpenCompositeWizard}
        onOpenMosaicWizard={onOpenMosaicWizard}
        onOpenComparisonPicker={onOpenComparisonPicker}
      />
    );

    fireEvent.click(screen.getByTitle('Create composite image'));
    expect(onOpenCompositeWizard).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTitle('Create a WCS-aligned mosaic from multiple FITS images'));
    expect(onOpenMosaicWizard).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTitle('Compare two FITS images (blink, side-by-side, or overlay)'));
    expect(onOpenComparisonPicker).toHaveBeenCalledOnce();
  });

  it('composite button is enabled when selectedCount >= 3', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} selectedCount={3} />);

    const compositeBtn = container.querySelector('.composite-btn');
    expect(compositeBtn).not.toBeDisabled();
  });

  it('composite button is disabled when selectedCount < 3', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} selectedCount={2} />);

    const compositeBtn = container.querySelector('.composite-btn');
    expect(compositeBtn).toBeDisabled();
  });

  it('mosaic button has ready class when selectedCount >= 2', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} selectedCount={2} />);

    const mosaicBtn = container.querySelector('.mosaic-open-btn');
    expect(mosaicBtn).toHaveClass('ready');
  });

  it('mosaic button does not have ready class when selectedCount < 2', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} selectedCount={1} />);

    const mosaicBtn = container.querySelector('.mosaic-open-btn');
    expect(mosaicBtn).not.toHaveClass('ready');
  });

  it('aria-hidden is false when visible', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} visible={true} />);

    const bar = container.querySelector('.floating-analysis-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'false');
  });

  it('aria-hidden is true when not visible', () => {
    const { container } = render(<FloatingAnalysisBar {...defaultProps} visible={false} />);

    const bar = container.querySelector('.floating-analysis-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows "No files selected" when selectedCount is 0', () => {
    render(<FloatingAnalysisBar {...defaultProps} selectedCount={0} />);
    expect(screen.getByText('No files selected')).toBeInTheDocument();
  });

  it('shows singular "1 file selected" when selectedCount is 1', () => {
    render(<FloatingAnalysisBar {...defaultProps} selectedCount={1} />);
    expect(screen.getByText('1 file selected')).toBeInTheDocument();
  });

  it('shows plural "5 files selected" when selectedCount is 5', () => {
    render(<FloatingAnalysisBar {...defaultProps} selectedCount={5} />);
    expect(screen.getByText('5 files selected')).toBeInTheDocument();
  });
});
