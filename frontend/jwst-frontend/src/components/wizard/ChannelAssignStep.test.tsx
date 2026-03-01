import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelAssignStep } from './ChannelAssignStep';
import { createDefaultRGBChannels } from '../../types/CompositeTypes';
import type { JwstDataModel } from '../../types/JwstDataTypes';

vi.mock('../../config/api', () => ({
  API_BASE_URL: 'http://test',
}));

function makeImage(
  overrides: Partial<JwstDataModel> & { id: string; fileName: string }
): JwstDataModel {
  return {
    dataType: 'image',
    uploadDate: '2024-01-01',
    metadata: {},
    fileSize: 1000,
    processingStatus: 'completed',
    tags: [],
    isArchived: false,
    processingResults: [],
    ...overrides,
  } as JwstDataModel;
}

describe('ChannelAssignStep', () => {
  const defaultProps = {
    allImages: [],
    channels: createDefaultRGBChannels(),
    onChannelsChange: vi.fn(),
  };

  it('renders the step header', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.getByText('Assign Channels')).toBeInTheDocument();
  });

  it('renders preset buttons', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.getByText('RGB')).toBeInTheDocument();
    expect(screen.getByText('LRGB')).toBeInTheDocument();
  });

  it('renders auto-assign and clear buttons', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.getByText('Auto-Assign by Filter')).toBeInTheDocument();
    expect(screen.getByText('Clear All')).toBeInTheDocument();
  });

  it('renders Add Channel button', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.getByText('Add Channel')).toBeInTheDocument();
  });

  it('renders available images pool', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.getByText('Available Images')).toBeInTheDocument();
  });

  it('does not render filter toolbar when pool is empty', () => {
    render(<ChannelAssignStep {...defaultProps} />);
    expect(screen.queryByPlaceholderText(/search by name/i)).not.toBeInTheDocument();
  });

  it('renders filter toolbar when pool has images', () => {
    const images = [
      makeImage({
        id: '1',
        fileName: 'crab_f200w.fits',
        imageInfo: { width: 100, height: 100, targetName: 'Crab Nebula', filter: 'F200W' },
      }),
      makeImage({
        id: '2',
        fileName: 'orion_f770w.fits',
        imageInfo: { width: 100, height: 100, targetName: 'Orion Nebula', filter: 'F770W' },
      }),
    ];
    render(<ChannelAssignStep {...defaultProps} allImages={images} />);
    expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Target')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter')).toBeInTheDocument();
  });
});
