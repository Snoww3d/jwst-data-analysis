import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultStep } from './ResultStep';
import type { NChannelConfigPayload } from '../../types/CompositeTypes';

vi.mock('./ExportFramingPanel', () => ({
  ExportFramingPanel: () => <div />,
}));

const channels: NChannelConfigPayload[] = [
  {
    dataIds: ['f356w-data'],
    color: { hue: 210 },
    label: 'F356W',
    stretch: 'asinh',
    blackPoint: 0,
    whitePoint: 1,
    gamma: 1,
    asinhA: 0.1,
    curve: 'linear',
    weight: 1,
  },
];

function renderResultStep(onChannelsChange = vi.fn()) {
  render(
    <MemoryRouter>
      <ResultStep
        targetName="Cassiopeia A"
        recipeName="2 filters - NIRCam"
        filters={['F356W']}
        previewUrl={null}
        isExporting={false}
        exportError={null}
        compositeWarning={null}
        onAdjust={vi.fn()}
        channels={channels}
        onChannelsChange={onChannelsChange}
        activePresetId="auto"
        onPresetChange={vi.fn()}
        onExport={vi.fn()}
      />
    </MemoryRouter>
  );
  return onChannelsChange;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ResultStep channel colors', () => {
  it('keeps a custom color open until it is applied', () => {
    vi.useFakeTimers();
    const onChannelsChange = renderResultStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change color' }));
    fireEvent.change(screen.getByLabelText('Custom hue'), { target: { value: '300' } });

    expect(screen.getByLabelText('Custom hue')).toHaveValue('300');
    expect(screen.getByRole('button', { name: 'Apply color' })).toBeInTheDocument();
    expect(onChannelsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply color' }));
    act(() => vi.advanceTimersByTime(1000));

    expect(onChannelsChange).toHaveBeenCalledWith([
      expect.objectContaining({ color: { hue: 300 } }),
    ]);
    expect(screen.queryByRole('button', { name: 'Apply color' })).not.toBeInTheDocument();
  });

  it('stages a preset selection until it is applied', () => {
    vi.useFakeTimers();
    const onChannelsChange = renderResultStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));

    expect(onChannelsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply color' }));
    act(() => vi.advanceTimersByTime(1000));

    expect(onChannelsChange).toHaveBeenCalledWith([
      expect.objectContaining({ color: { hue: 120 } }),
    ]);
    expect(screen.queryByRole('button', { name: 'Apply color' })).not.toBeInTheDocument();
  });

  it('discards a staged color when cancelled', () => {
    vi.useFakeTimers();
    const onChannelsChange = renderResultStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change color' }));
    fireEvent.change(screen.getByLabelText('Custom hue'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    act(() => vi.advanceTimersByTime(1000));

    expect(onChannelsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply color' })).not.toBeInTheDocument();
  });

  it('discards a staged color when Escape is pressed', () => {
    vi.useFakeTimers();
    const onChannelsChange = renderResultStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change color' }));
    fireEvent.change(screen.getByLabelText('Custom hue'), { target: { value: '300' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(1000));

    expect(onChannelsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply color' })).not.toBeInTheDocument();
  });

  it('discards a staged color when clicking outside the popover', () => {
    vi.useFakeTimers();
    const onChannelsChange = renderResultStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change color' }));
    fireEvent.change(screen.getByLabelText('Custom hue'), { target: { value: '300' } });
    fireEvent.mouseDown(document.body);
    act(() => vi.advanceTimersByTime(1000));

    expect(onChannelsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply color' })).not.toBeInTheDocument();
  });
});
