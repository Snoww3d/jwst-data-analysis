import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExportOptions } from '../types/JwstDataTypes';
import ExportOptionsPanel from './ExportOptionsPanel';

// Mock the ExportResolutionPresets
vi.mock('../types/JwstDataTypes', () => ({
  ExportResolutionPresets: {
    standard: { width: 1200, height: 1200, label: 'Standard (1200px)' },
    high: { width: 2048, height: 2048, label: 'High (2048px)' },
    maximum: { width: 4096, height: 4096, label: 'Maximum (4096px)' },
    custom: { width: 0, height: 0, label: 'Custom' },
  },
}));

describe('ExportOptionsPanel', () => {
  let onExport: ReturnType<typeof vi.fn<(options: ExportOptions) => void>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onExport = vi.fn<(options: ExportOptions) => void>();
    onClose = vi.fn<() => void>();
  });

  const renderPanel = (
    props: Partial<{
      onExport: (options: ExportOptions) => void;
      onClose: () => void;
      isExporting: boolean;
      disabled: boolean;
    }> = {}
  ) => {
    return render(
      <ExportOptionsPanel onExport={onExport} onClose={onClose} isExporting={false} {...props} />
    );
  };

  it('renders the panel with title', () => {
    renderPanel();
    expect(screen.getByText('Export Image')).toBeInTheDocument();
  });

  it('shows format options (PNG and JPEG)', () => {
    renderPanel();
    expect(screen.getByText('PNG')).toBeInTheDocument();
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });

  it('PNG is the default format', () => {
    renderPanel();
    const pngBtn = screen.getByText('PNG');
    expect(pngBtn.className).toContain('active');
  });

  it('shows quality slider when JPEG is selected', () => {
    renderPanel();
    // Initially PNG — no quality slider
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();

    // Click JPEG
    fireEvent.click(screen.getByText('JPEG'));
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('hides quality slider when PNG is selected', () => {
    renderPanel();
    // Switch to JPEG first
    fireEvent.click(screen.getByText('JPEG'));
    expect(screen.getByText('Quality')).toBeInTheDocument();

    // Switch back to PNG
    fireEvent.click(screen.getByText('PNG'));
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
  });

  it('shows resolution select with presets', () => {
    renderPanel();
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('Standard (1200px)')).toBeInTheDocument();
  });

  it('shows custom dimension inputs when custom resolution selected', () => {
    renderPanel();
    const select = screen.getByDisplayValue('Standard (1200px)');
    fireEvent.change(select, { target: { value: 'custom' } });
    expect(screen.getByText('Width')).toBeInTheDocument();
    expect(screen.getByText('Height')).toBeInTheDocument();
  });

  it('hides custom dimension inputs for preset resolutions', () => {
    renderPanel();
    expect(screen.queryByText('Width')).not.toBeInTheDocument();
    expect(screen.queryByText('Height')).not.toBeInTheDocument();
  });

  it('shows AVM metadata toggle', () => {
    renderPanel();
    expect(screen.getByText('Embed AVM metadata')).toBeInTheDocument();
  });

  it('AVM toggle is checked by default', () => {
    renderPanel();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('calls onExport when export button is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Export PNG'));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'png',
        quality: 90,
        width: 1200,
        height: 1200,
        embedAvm: true,
      })
    );
  });

  it('calls onClose when close button is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Close export options'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "Exporting..." when isExporting is true', () => {
    renderPanel({ isExporting: true });
    expect(screen.getByText('Exporting...')).toBeInTheDocument();
  });

  it('disables export button when isExporting', () => {
    renderPanel({ isExporting: true });
    const exportBtn = screen.getByText('Exporting...').closest('button');
    expect(exportBtn).toBeDisabled();
  });

  it('disables export button when disabled prop is true', () => {
    renderPanel({ disabled: true });
    const exportBtn = screen.getByText('Export PNG').closest('button');
    expect(exportBtn).toBeDisabled();
  });

  it('shows format-specific hint for PNG', () => {
    renderPanel();
    expect(screen.getByText('Lossless, larger file size')).toBeInTheDocument();
  });

  it('shows format-specific hint for JPEG', () => {
    renderPanel();
    fireEvent.click(screen.getByText('JPEG'));
    expect(screen.getByText('Smaller file size, adjustable quality')).toBeInTheDocument();
  });

  it('export button text updates for JPEG format', () => {
    renderPanel();
    fireEvent.click(screen.getByText('JPEG'));
    expect(screen.getByText('Export JPEG')).toBeInTheDocument();
  });
});
