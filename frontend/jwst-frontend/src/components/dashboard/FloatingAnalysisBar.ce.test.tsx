import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FloatingAnalysisBar from './FloatingAnalysisBar';

// CE: the floating mirror of the toolbar's analysis row must not resurface
// the Composite/Mosaic wizards (round-1 review catch)
vi.mock('../../config/ce', () => ({ CE_MODE: true }));

describe('FloatingAnalysisBar in CE mode', () => {
  it('renders only the read-only Compare action', () => {
    render(
      <FloatingAnalysisBar
        visible={true}
        selectedCount={0}
        onOpenCompositeWizard={vi.fn()}
        onOpenMosaicWizard={vi.fn()}
        onOpenComparisonPicker={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /Composite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /WCS Mosaic/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/files? selected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Compare/ })).toBeInTheDocument();
  });
});
