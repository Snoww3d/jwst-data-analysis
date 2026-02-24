import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelAssignStep } from './ChannelAssignStep';
import { createDefaultRGBChannels } from '../../types/CompositeTypes';

vi.mock('../../config/api', () => ({
  API_BASE_URL: 'http://test',
}));

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
});
