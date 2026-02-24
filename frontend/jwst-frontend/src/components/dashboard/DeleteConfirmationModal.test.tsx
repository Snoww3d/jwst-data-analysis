import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../utils/formatUtils', () => ({
  formatFileSize: (bytes: number) => `${bytes} bytes`,
}));

vi.mock('../../types/JwstDataTypes', () => ({
  ProcessingLevelColors: { L1: '#blue', L2a: '#green', unknown: '#gray' },
  ProcessingLevelLabels: { L1: 'Level 1', L2a: 'Level 2a' },
}));

import DeleteConfirmationModal from './DeleteConfirmationModal';

describe('DeleteConfirmationModal', () => {
  const baseProps = {
    variant: 'observation' as const,
    observationBaseId: 'jw01234-obs001',
    fileCount: 3,
    totalSizeBytes: 1048576,
    fileNames: ['file1.fits', 'file2.fits', 'file3.fits'],
    isDeleting: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('observation variant: shows "Delete Observation" title', () => {
    render(<DeleteConfirmationModal {...baseProps} variant="observation" />);
    expect(screen.getByText('Delete Observation')).toBeInTheDocument();
  });

  it('level variant: shows "Delete Processing Level" title and level badge', () => {
    render(<DeleteConfirmationModal {...baseProps} variant="level" processingLevel="L1" />);
    expect(screen.getByText('Delete Processing Level')).toBeInTheDocument();
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });

  it('shows observation ID, file count, total size, and file names', () => {
    render(<DeleteConfirmationModal {...baseProps} />);

    expect(screen.getByText('jw01234-obs001')).toBeInTheDocument();
    // File count and size formatted by mock
    expect(
      screen.getByText((_, element) => {
        return element?.textContent === '3 files (1048576 bytes)';
      })
    ).toBeInTheDocument();
    expect(screen.getByText('file1.fits')).toBeInTheDocument();
    expect(screen.getByText('file2.fits')).toBeInTheDocument();
    expect(screen.getByText('file3.fits')).toBeInTheDocument();
  });

  it('confirm button calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmationModal {...baseProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('Delete Permanently'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmationModal {...baseProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('both buttons disabled when isDeleting', () => {
    render(<DeleteConfirmationModal {...baseProps} isDeleting={true} />);

    expect(screen.getByText('Deleting...')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('shows "Deleting..." when isDeleting', () => {
    render(<DeleteConfirmationModal {...baseProps} isDeleting={true} />);

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
    expect(screen.queryByText('Delete Permanently')).not.toBeInTheDocument();
  });

  it('overlay click calls onCancel when not deleting', () => {
    const onCancel = vi.fn();
    const { container } = render(<DeleteConfirmationModal {...baseProps} onCancel={onCancel} />);

    const overlay = container.querySelector('.delete-modal-overlay');
    if (!overlay) throw new Error('Expected .delete-modal-overlay element');
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('overlay click does NOT call onCancel when isDeleting', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteConfirmationModal {...baseProps} onCancel={onCancel} isDeleting={true} />
    );

    const overlay = container.querySelector('.delete-modal-overlay');
    if (!overlay) throw new Error('Expected .delete-modal-overlay element');
    fireEvent.click(overlay);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows singular "1 file" for fileCount of 1', () => {
    render(<DeleteConfirmationModal {...baseProps} fileCount={1} fileNames={['single.fits']} />);

    expect(
      screen.getByText((_, element) => {
        return element?.textContent === '1 file (1048576 bytes)';
      })
    ).toBeInTheDocument();
  });

  it('shows plural "2 files" for fileCount of 2', () => {
    render(
      <DeleteConfirmationModal {...baseProps} fileCount={2} fileNames={['a.fits', 'b.fits']} />
    );

    expect(
      screen.getByText((_, element) => {
        return element?.textContent === '2 files (1048576 bytes)';
      })
    ).toBeInTheDocument();
  });
});
