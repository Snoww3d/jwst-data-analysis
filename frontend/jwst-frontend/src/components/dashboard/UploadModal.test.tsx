import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UploadModal from './UploadModal';

describe('UploadModal', () => {
  const defaultProps = {
    onUpload: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders file input', () => {
    render(<UploadModal {...defaultProps} />);

    const fileInput = screen.getByTitle('Select a file to upload');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
  });

  it('renders data type select', () => {
    render(<UploadModal {...defaultProps} />);

    const select = screen.getByTitle('Select the data type');
    expect(select).toBeInTheDocument();
  });

  it('renders description textarea', () => {
    render(<UploadModal {...defaultProps} />);

    expect(screen.getByPlaceholderText('Optional description')).toBeInTheDocument();
  });

  it('renders tags input', () => {
    render(<UploadModal {...defaultProps} />);

    expect(screen.getByPlaceholderText('Comma-separated tags')).toBeInTheDocument();
  });

  it('cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(<UploadModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows "Upload JWST Data" header', () => {
    render(<UploadModal {...defaultProps} />);

    expect(screen.getByText('Upload JWST Data')).toBeInTheDocument();
  });

  it('data type options present', () => {
    render(<UploadModal {...defaultProps} />);

    expect(screen.getByText('Select type')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Sensor Data')).toBeInTheDocument();
    expect(screen.getByText('Spectral Data')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
  });
});
