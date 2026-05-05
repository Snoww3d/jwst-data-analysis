import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogPanel } from './LogPanel';

describe('LogPanel', () => {
  it('renders nothing when messages buffer is empty', () => {
    const { container } = render(<LogPanel messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('starts collapsed by default — only the disclosure button visible', () => {
    render(<LogPanel messages={['line one', 'line two']} />);
    const toggle = screen.getByRole('button', { name: /Show details/i });
    expect(toggle).toBeTruthy();
    expect(screen.queryByText('line one')).toBeNull();
    expect(screen.queryByText('line two')).toBeNull();
  });

  it('renders all buffered lines when expanded', () => {
    render(<LogPanel messages={['Reprojecting R (1 of 3)', 'Stretching G (2 of 3)']} />);
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
    expect(screen.getByText('Reprojecting R (1 of 3)')).toBeTruthy();
    expect(screen.getByText('Stretching G (2 of 3)')).toBeTruthy();
  });

  it('toggles between Show details and Hide details', () => {
    render(<LogPanel messages={['msg']} />);
    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toContain('Show details');
    fireEvent.click(toggle);
    expect(toggle.textContent).toContain('Hide details');
    fireEvent.click(toggle);
    expect(toggle.textContent).toContain('Show details');
  });

  it('shows the buffered entry count next to the toggle', () => {
    render(<LogPanel messages={['a', 'b', 'c', 'd', 'e']} />);
    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toContain('(5)');
  });

  it('starts open when defaultOpen=true', () => {
    render(<LogPanel messages={['hello']} defaultOpen />);
    expect(screen.getByText('hello')).toBeTruthy();
    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toContain('Hide details');
  });

  it('exposes the log region as a labeled region (no aria-live to avoid SR spam)', () => {
    // role="log" implies aria-live=polite; with ~36 messages emitted over ~30s
    // that would spam screen readers (same class as the PR #1456 wavelength
    // ribbon regression). Users who open this collapsed-by-default panel
    // explicitly opted in to seeing entries; no live announcements needed.
    render(<LogPanel messages={['x']} defaultOpen />);
    const region = screen.getByRole('region', { name: /Composite generation log/i });
    expect(region).toBeTruthy();
    // Explicitly off so the panel doesn't inherit aria-live="polite" from
    // an ancestor like ProcessStep — see LogPanel.tsx for rationale.
    expect(region.getAttribute('aria-live')).toBe('off');
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('does NOT auto-scroll when the user has scrolled up to read history', () => {
    const setSpy = vi.fn();
    let stubbedScrollTop = 0;
    Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return stubbedScrollTop;
      },
      set(value) {
        setSpy(value);
        stubbedScrollTop = value;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 1000;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 200;
      },
    });

    const { rerender, container } = render(<LogPanel messages={['one']} defaultOpen />);
    setSpy.mockClear();

    // Simulate the user scrolling up — distanceFromBottom will be 1000-100-200 = 700, > 16.
    stubbedScrollTop = 100;
    const buffer = container.querySelector('.log-panel-buffer') as HTMLDivElement;
    fireEvent.scroll(buffer);

    // New message arrives — auto-scroll should be frozen.
    rerender(<LogPanel messages={['one', 'two']} defaultOpen />);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('auto-scrolls to bottom on new messages when open and not user-scrolled', () => {
    // jsdom doesn't compute layout, so scrollHeight/scrollTop are stub-set to 0.
    // We can still verify the effect attempts to scroll by spying on scrollTop assignment.
    const setSpy = vi.fn();
    Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return 0;
      },
      set(value) {
        setSpy(value);
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 1000;
      },
    });

    const { rerender } = render(<LogPanel messages={['one']} defaultOpen />);
    rerender(<LogPanel messages={['one', 'two']} defaultOpen />);

    // Effect runs after render; scrollTop should have been assigned to scrollHeight (1000)
    expect(setSpy).toHaveBeenCalledWith(1000);
  });
});
