import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CompositePreviewStep } from './CompositePreviewStep';
import { createDefaultRGBChannels } from '../../types/CompositeTypes';

vi.mock('../../services', () => ({
  compositeService: {
    generatePreview: vi.fn(() => Promise.resolve(new Blob())),
    exportComposite: vi.fn(() => Promise.resolve(new Blob())),
  },
}));

vi.mock('../StretchControls', () => ({
  default: () => <div data-testid="stretch-controls" />,
}));

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('CompositePreviewStep', () => {
  const defaultProps = {
    selectedImages: [],
    channels: createDefaultRGBChannels(),
    onChannelsChange: vi.fn(),
  };

  it('renders without crashing', () => {
    const { container } = render(<CompositePreviewStep {...defaultProps} />);
    expect(container).toBeTruthy();
  });
});
