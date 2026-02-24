import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CubeNavigator from './CubeNavigator';
import type { CubeInfoResponse } from '../types/JwstDataTypes';

describe('CubeNavigator', () => {
  const cubeInfo: CubeInfoResponse = {
    data_id: 'test-cube',
    is_cube: true,
    n_slices: 10,
    axis3: null,
    slice_unit: 'um',
    slice_label: 'Wavelength',
  };

  const defaultProps = {
    cubeInfo,
    currentSlice: 0,
    onSliceChange: vi.fn(),
    isPlaying: false,
    onPlayPause: vi.fn(),
    playbackSpeed: 1,
    onPlaybackSpeedChange: vi.fn(),
  };

  it('renders the header and slice count', () => {
    render(<CubeNavigator {...defaultProps} />);
    expect(screen.getByText('Cube Navigator')).toBeInTheDocument();
    expect(screen.getByText('10 slices')).toBeInTheDocument();
  });

  it('renders navigation buttons', () => {
    render(<CubeNavigator {...defaultProps} />);
    expect(screen.getByLabelText('First slice')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous slice')).toBeInTheDocument();
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
    expect(screen.getByLabelText('Next slice')).toBeInTheDocument();
    expect(screen.getByLabelText('Last slice')).toBeInTheDocument();
  });

  it('renders slider', () => {
    render(<CubeNavigator {...defaultProps} />);
    expect(screen.getByLabelText('Slice selector')).toBeInTheDocument();
  });

  it('hides body when collapsed', () => {
    render(<CubeNavigator {...defaultProps} collapsed={true} />);
    expect(screen.getByText('Cube Navigator')).toBeInTheDocument();
    expect(screen.queryByLabelText('Slice selector')).not.toBeInTheDocument();
  });
});
