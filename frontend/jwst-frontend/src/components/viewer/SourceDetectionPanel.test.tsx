import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceDetectionPanel from './SourceDetectionPanel';

describe('SourceDetectionPanel', () => {
  const defaultProps = {
    dataId: 'test-id',
    onDetect: vi.fn(() => Promise.resolve()),
    result: null,
    loading: false,
    error: null,
    showOverlay: false,
    onToggleOverlay: vi.fn(),
    onClear: vi.fn(),
  };

  it('renders the panel header', () => {
    render(<SourceDetectionPanel {...defaultProps} />);
    expect(screen.getByText('Source Detection')).toBeInTheDocument();
  });

  it('renders detect button when not collapsed', () => {
    render(<SourceDetectionPanel {...defaultProps} collapsed={false} />);
    expect(screen.getByText('Detect Sources')).toBeInTheDocument();
  });

  it('renders threshold slider when not collapsed', () => {
    render(<SourceDetectionPanel {...defaultProps} collapsed={false} />);
    expect(screen.getByText('Threshold (sigma)')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    render(<SourceDetectionPanel {...defaultProps} collapsed={true} />);
    expect(screen.getByText('Source Detection')).toBeInTheDocument();
    expect(screen.queryByText('Detect Sources')).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<SourceDetectionPanel {...defaultProps} loading={true} collapsed={false} />);
    expect(screen.getByText('Detecting...')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<SourceDetectionPanel {...defaultProps} error="Detection failed" collapsed={false} />);
    expect(screen.getByText('Detection failed')).toBeInTheDocument();
  });
});
