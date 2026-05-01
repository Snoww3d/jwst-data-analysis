import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcessStep } from './ProcessStep';

const baseProps = {
  targetName: 'NGC 346',
  recipeName: 'NASA NIRCam',
  requiresMosaic: false,
  phase: 'composite' as const,
  progress: null,
  isComplete: false,
  channelCount: 3,
  fileCount: 12,
};

describe('ProcessStep — Continue anyway override', () => {
  it('renders only Retry Processing when error is unrelated', () => {
    const onRetry = vi.fn();
    render(<ProcessStep {...baseProps} error="Network error: ECONNREFUSED" onRetry={onRetry} />);

    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull();
  });

  it('renders Continue anyway when error matches MEMORY_BUDGET: prefix', () => {
    const onRetry = vi.fn();
    const onContinueAnyway = vi.fn();
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={onRetry}
        onContinueAnyway={onContinueAnyway}
      />
    );

    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /continue anyway/i });
    expect(continueBtn).toBeInTheDocument();
    // Projected output shape parsed from the engine detail.
    expect(continueBtn.textContent).toMatch(/4353×3417/);
  });

  it('strips MEMORY_BUDGET: prefix from displayed error text', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={vi.fn()}
      />
    );

    // The literal MEMORY_BUDGET: prefix must not leak into user-visible copy.
    expect(screen.queryByText(/MEMORY_BUDGET:/)).toBeNull();
    expect(screen.getByText(/Composite output would shrink to 38%/)).toBeInTheDocument();
  });

  it('detects memory-budget pattern in sync-path errors without prefix', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={
          'Composite output would shrink to 38% of requested side length ' +
          '(4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /continue anyway/i })).toBeInTheDocument();
  });

  it('clicking Continue anyway calls onContinueAnyway', () => {
    const onContinueAnyway = vi.fn();
    render(
      <ProcessStep
        {...baseProps}
        error={
          'MEMORY_BUDGET:Composite output would shrink to 38% (4353x3417 from 11399x8949). ' +
          'Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.'
        }
        onRetry={vi.fn()}
        onContinueAnyway={onContinueAnyway}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }));
    expect(onContinueAnyway).toHaveBeenCalledTimes(1);
  });

  it('does NOT render Continue anyway when onContinueAnyway is omitted (back-compat)', () => {
    render(
      <ProcessStep
        {...baseProps}
        error={'MEMORY_BUDGET:Composite output would shrink to 38% (4353x3417 from 11399x8949).'}
        onRetry={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull();
  });
});

describe('ProcessStep — Wavelength ribbon', () => {
  const ribbonBaseProps = {
    ...baseProps,
    onRetry: vi.fn(),
    error: null,
  };

  it('renders one tile per filter (NGC 346 NIRCam: F200W/F277W/F335M/F444W)', () => {
    render(
      <ProcessStep
        {...ribbonBaseProps}
        filters={['F200W', 'F277W', 'F335M', 'F444W']}
        colorMapping={{
          F200W: '#0000ff',
          F277W: '#00ffff',
          F335M: '#ff8000',
          F444W: '#ff0000',
        }}
      />
    );

    const ribbon = screen.getByTestId('wavelength-ribbon');
    expect(ribbon).toBeInTheDocument();
    expect(ribbon.textContent).toMatch(/F200W/);
    expect(ribbon.textContent).toMatch(/F277W/);
    expect(ribbon.textContent).toMatch(/F335M/);
    expect(ribbon.textContent).toMatch(/F444W/);
  });

  it('orders tiles shortest→longest wavelength regardless of input order', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['F444W', 'F200W', 'F335M', 'F277W']} />);

    const ribbon = screen.getByTestId('wavelength-ribbon');
    const filterTexts = Array.from(ribbon.querySelectorAll('.wavelength-ribbon-tile-filter')).map(
      (el) => el.textContent
    );
    expect(filterTexts).toEqual(['F200W', 'F277W', 'F335M', 'F444W']);
  });

  it('hides ribbon when filters is undefined', () => {
    render(<ProcessStep {...ribbonBaseProps} />);
    expect(screen.queryByTestId('wavelength-ribbon')).toBeNull();
  });

  it('hides ribbon when filters has 0 entries', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={[]} />);
    expect(screen.queryByTestId('wavelength-ribbon')).toBeNull();
  });

  it('hides ribbon for single-filter composites', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['F444W']} />);
    expect(screen.queryByTestId('wavelength-ribbon')).toBeNull();
  });

  it('hides ribbon when no filter has a known wavelength', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['UNKNOWN_A', 'UNKNOWN_B']} />);
    expect(screen.queryByTestId('wavelength-ribbon')).toBeNull();
  });

  it('uses colorMapping color when present (F200W → #0000ff)', () => {
    render(
      <ProcessStep
        {...ribbonBaseProps}
        filters={['F200W', 'F444W']}
        colorMapping={{ F200W: '#0000ff', F444W: '#ff0000' }}
      />
    );

    const tiles = screen
      .getByTestId('wavelength-ribbon')
      .querySelectorAll<HTMLDivElement>('.wavelength-ribbon-tile');
    // First tile (sorted) is F200W. jsdom normalizes #0000ff → rgb(0, 0, 255).
    expect(tiles[0].style.backgroundColor).toBe('rgb(0, 0, 255)');
    expect(tiles[1].style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('falls back to wavelength-derived color when colorMapping omitted', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['F200W', 'F444W']} />);

    const tiles = screen
      .getByTestId('wavelength-ribbon')
      .querySelectorAll<HTMLDivElement>('.wavelength-ribbon-tile');
    // Fallback path is wavelengthToHue → hueToHex; just assert a non-empty
    // background is set so we don't pin to a specific palette choice.
    expect(tiles[0].style.backgroundColor).not.toBe('');
    expect(tiles[1].style.backgroundColor).not.toBe('');
    expect(tiles[0].style.backgroundColor).not.toBe(tiles[1].style.backgroundColor);
  });

  it('tolerates colorMapping casing mismatch (lowercase recipe key)', () => {
    render(
      <ProcessStep
        {...ribbonBaseProps}
        filters={['f200w', 'f444w']}
        colorMapping={{ F200W: '#0000ff', F444W: '#ff0000' }}
      />
    );

    const tiles = screen
      .getByTestId('wavelength-ribbon')
      .querySelectorAll<HTMLDivElement>('.wavelength-ribbon-tile');
    expect(tiles[0].style.backgroundColor).toBe('rgb(0, 0, 255)');
  });

  it('handles span-zero (all filters identical wavelength) without NaN', () => {
    // F200W and F200W_NIRISS both map to 1.989 µm in FILTER_WAVELENGTHS.
    render(<ProcessStep {...ribbonBaseProps} filters={['F200W', 'F200W_NIRISS']} />);

    const tiles = screen
      .getByTestId('wavelength-ribbon')
      .querySelectorAll<HTMLDivElement>('.wavelength-ribbon-tile');
    expect(tiles).toHaveLength(2);
    // Span-zero collapses every tile's position to 0.5 → left calc resolves
    // to "50% + 0px". jsdom may serialize calc literally; assert no NaN and
    // both tiles share the same left value.
    for (const tile of tiles) {
      expect(tile.style.left).not.toMatch(/NaN/);
      expect(tile.style.left).not.toBe('');
    }
    expect(tiles[0].style.left).toBe(tiles[1].style.left);
  });

  it('drops unknown-wavelength filters from the ribbon (mixed known + unknown)', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['F200W', 'UNKNOWN_X', 'F444W']} />);

    const ribbon = screen.getByTestId('wavelength-ribbon');
    const filterTexts = Array.from(ribbon.querySelectorAll('.wavelength-ribbon-tile-filter')).map(
      (el) => el.textContent
    );
    expect(filterTexts).toEqual(['F200W', 'F444W']);
    expect(ribbon.textContent).not.toMatch(/UNKNOWN_X/);
  });

  it('normalizes filter casing in rendered label (lowercase input → uppercase tile)', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['f200w', 'F444W']} />);

    const ribbon = screen.getByTestId('wavelength-ribbon');
    const filterTexts = Array.from(ribbon.querySelectorAll('.wavelength-ribbon-tile-filter')).map(
      (el) => el.textContent
    );
    expect(filterTexts).toEqual(['F200W', 'F444W']);
  });

  it('hides ribbon when error is set even if filters provided', () => {
    render(<ProcessStep {...ribbonBaseProps} filters={['F200W', 'F444W']} error="Network error" />);

    expect(screen.queryByTestId('wavelength-ribbon')).toBeNull();
  });
});
