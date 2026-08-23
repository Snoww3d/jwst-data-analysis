import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  SPLIT_VIEW_DEFAULT_RATIO,
  SplitView,
  loadSplitRatio,
  saveSplitRatio,
  splitViewStorageKey,
} from './SplitView';

function mockWidth(el: HTMLElement, width: number, left = 0) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 100,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('SplitView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders both panes and an accessible divider with the default ratio', () => {
    render(<SplitView storageKey="t" primary={<p>left</p>} secondary={<p>right</p>} />);
    expect(screen.getByText('left')).toBeInTheDocument();
    expect(screen.getByText('right')).toBeInTheDocument();
    const sep = screen.getByRole('separator', { name: 'Resize panes' });
    expect(sep).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(SPLIT_VIEW_DEFAULT_RATIO * 100))
    );
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('hides the secondary pane and divider when collapsed', () => {
    render(<SplitView storageKey="t" collapsed primary={<p>left</p>} secondary={<p>right</p>} />);
    expect(screen.getByText('left')).toBeInTheDocument();
    expect(screen.queryByText('right')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('drags the divider with pointer events and persists the ratio', () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitView
        storageKey="drag"
        primary={<p>left</p>}
        secondary={<p>right</p>}
        onRatioChange={onRatioChange}
      />
    );
    const root = container.querySelector<HTMLElement>('.split-view')!;
    mockWidth(root, 1000);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 0, clientX: 550, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '40');
    expect(root.className).toContain('split-view-dragging');
    fireEvent.pointerUp(sep, { clientX: 400, pointerId: 1 });
    expect(root.className).not.toContain('split-view-dragging');
    expect(onRatioChange).toHaveBeenCalledWith(0.4);
    expect(localStorage.getItem(splitViewStorageKey('drag'))).toBe('0.4000');
    expect(root.style.getPropertyValue('--split-ratio')).toBe('40%');
  });

  it('clamps a drag to the min/max ratios', () => {
    const { container } = render(
      <SplitView storageKey="clamp" primary={<p>l</p>} secondary={<p>r</p>} />
    );
    mockWidth(container.querySelector<HTMLElement>('.split-view')!, 1000);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 0, clientX: 550, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 10, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '25');
    fireEvent.pointerDown(sep, { button: 0, clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 990, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 990, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '75');
  });

  it('moves with the keyboard: arrows step, Home/End jump', () => {
    render(<SplitView storageKey="kb" primary={<p>l</p>} secondary={<p>r</p>} />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '53');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '57');
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', '25');
    fireEvent.keyDown(sep, { key: 'End' });
    expect(sep).toHaveAttribute('aria-valuenow', '75');
    expect(loadSplitRatio('kb', 0)).toBe(0.75);
  });

  it('restores a persisted ratio and ignores garbage', () => {
    saveSplitRatio('persist', 0.33);
    const { unmount } = render(
      <SplitView storageKey="persist" primary={<p>l</p>} secondary={<p>r</p>} />
    );
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '33');
    unmount();
    localStorage.setItem(splitViewStorageKey('bad'), 'nope');
    render(<SplitView storageKey="bad" primary={<p>l</p>} secondary={<p>r</p>} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '55');
    // out-of-range stored values are clamped into the allowed band
    localStorage.setItem(splitViewStorageKey('oob'), '0.95');
    expect(loadSplitRatio('oob', 0.5)).toBe(0.95);
  });

  it('ignores non-primary pointer buttons', () => {
    const { container } = render(
      <SplitView storageKey="btn" primary={<p>l</p>} secondary={<p>r</p>} />
    );
    mockWidth(container.querySelector<HTMLElement>('.split-view')!, 1000);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 2, clientX: 550, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 300, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '55');
  });
});
