import type { AladinOptions } from '../../../types/aladin-lite';
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkyMap, { coverageTiers, type SkyMapHandle } from './SkyMap';
import { AladinLoadError } from '../../../lib/loadAladin';

const loadAladinMock = vi.fn();
vi.mock('../../../lib/loadAladin', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/loadAladin')>('../../../lib/loadAladin');
  return { ...actual, loadAladin: (...args: unknown[]) => loadAladinMock(...args) };
});

/** A recording stand-in for `window.A` + the Aladin instance. */
function makeStubA() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const overlays: { name?: string; items: unknown[]; removeAll: () => void }[] = [];
  const mocs: unknown[] = [];
  const aladin = {
    on: vi.fn((name: string, cb: (...args: unknown[]) => void) => {
      handlers[name] = cb;
    }),
    addOverlay: vi.fn(),
    addMOC: vi.fn((m: unknown) => mocs.push(m)),
    gotoRaDec: vi.fn(),
    setFoV: vi.fn(),
    getFov: vi.fn(() => [60, 40]),
    getRaDec: vi.fn(() => [10, 20]),
    getSize: vi.fn(() => [800, 600]),
    setBaseImageLayer: vi.fn(),
    setProjection: vi.fn(),
    // Draw-to-search (Phase 6): pixel→sky is a simple linear map for tests.
    select: vi.fn(),
    fire: vi.fn(),
    pix2world: vi.fn((x: number, y: number) => [x / 10, y / 10]),
    angularDist: vi.fn(
      (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) / 10
    ),
  };
  const A = {
    init: Promise.resolve(),
    aladin: vi.fn((_el: unknown, _opts?: unknown) => aladin),
    graphicOverlay: vi.fn((opts?: { name?: string }) => {
      const o = {
        name: opts?.name,
        items: [] as unknown[],
        addFootprints: vi.fn((fps: unknown[]) => o.items.push(...fps)),
        add: vi.fn(),
        removeAll: vi.fn(() => {
          o.items = [];
        }),
        reportChange: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        remove: vi.fn(),
      };
      overlays.push(o);
      return o;
    }),
    footprintsFromSTCS: vi.fn((stcs: string, opts?: Record<string, unknown>) => [
      { stcs, opts, data: undefined as unknown },
    ]),
    MOCFromJSON: vi.fn((json: unknown, opts: unknown) => ({
      json,
      opts,
      hide: vi.fn(),
      show: vi.fn(),
    })),
    HiPS: vi.fn((id: string, opts?: { errorCallback?: () => void }) => ({ id, opts })),
    polygon: vi.fn(),
    circle: vi.fn(),
  };
  return { A, aladin, handlers, overlays, mocs };
}

const ROWS = [
  {
    obs_id: 'a',
    instrument_name: 'MIRI/IMAGE',
    s_region: 'POLYGON 151.75 -40.40 151.79 -40.42 151.75 -40.47 151.71 -40.45',
  },
  { obs_id: 'b', instrument_name: 'NIRCAM/IMAGE', s_region: 'POLYGON 10 10 11 10 11 11 10 11' },
  { obs_id: 'no-region', instrument_name: 'NIRCAM/IMAGE' },
];

describe('SkyMap', () => {
  beforeEach(() => {
    localStorage.clear();
    loadAladinMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "Sky map unavailable" when the loader times out', async () => {
    loadAladinMock.mockRejectedValue(new AladinLoadError('took too long', 'timeout'));
    render(<SkyMap rows={ROWS} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading sky map');
    await waitFor(() => expect(screen.getByText('Sky map unavailable')).toBeInTheDocument());
    expect(screen.getByText(/did not load in time/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Background survey')).toBeNull();
  });

  it('explains a missing WebGL2', async () => {
    loadAladinMock.mockRejectedValue(new AladinLoadError('no', 'no-webgl'));
    render(<SkyMap />);
    await waitFor(() => expect(screen.getByText(/no WebGL2/)).toBeInTheDocument());
  });

  it('creates Aladin with the chrome hidden, draws footprints coloured by instrument, fits', async () => {
    const stub = makeStubA();
    loadAladinMock.mockResolvedValue(stub.A);
    const ref = createRef<SkyMapHandle>();
    render(<SkyMap ref={ref} rows={ROWS} />);
    await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());

    const opts = stub.A.aladin.mock.calls[0][1] as unknown as AladinOptions;
    expect(opts).toMatchObject({
      survey: 'P/DSS2/color',
      showReticle: false,
      showLayersControl: false,
      showFullscreenControl: false,
      showGotoControl: false,
      cooFrame: 'ICRS',
      fov: 180,
    });
    // three overlays: footprints + emphasis + region (Phase 6)
    expect(stub.aladin.addOverlay).toHaveBeenCalledTimes(3);
    const footprints = stub.overlays.find((o) => o.name === 'mast-footprints')!;
    expect(footprints.items).toHaveLength(2); // the row without s_region is skipped
    const [miri, nircam] = footprints.items as {
      data: { obsId: string };
      opts: { color: string };
    }[];
    expect(miri.data.obsId).toBe('a');
    expect(nircam.data.obsId).toBe('b');
    expect(miri.opts.color).not.toBe(nircam.opts.color);
    // auto-fit to the two footprints
    expect(stub.aladin.gotoRaDec).toHaveBeenCalled();
    expect(stub.aladin.setFoV).toHaveBeenCalled();
  });

  it('links hover/click from the map to obs ids and redraws emphasis for hover/select', async () => {
    const stub = makeStubA();
    loadAladinMock.mockResolvedValue(stub.A);
    const onHover = vi.fn();
    const onClick = vi.fn();
    const onSkyClick = vi.fn();
    const ref = createRef<SkyMapHandle>();
    const { rerender } = render(
      <SkyMap ref={ref} rows={ROWS} onHover={onHover} onClick={onClick} onSkyClick={onSkyClick} />
    );
    await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());

    act(() => stub.handlers.objectHovered({ data: { obsId: 'a' } }));
    expect(onHover).toHaveBeenCalledWith('a');
    act(() => stub.handlers.objectHoveredStop({ data: { obsId: 'a' } }));
    expect(onHover).toHaveBeenLastCalledWith(null);
    act(() => stub.handlers.click({ ra: 1, dec: 2, x: 0, y: 0 }));
    expect(onSkyClick).toHaveBeenCalledWith({ ra: 1, dec: 2 });
    act(() => stub.handlers.click({ ra: 1, dec: 2, x: 0, y: 0, isDragging: true }));
    expect(onSkyClick).toHaveBeenCalledTimes(1);
    // Aladin fires objectClicked and click for the SAME mouseup: the sky
    // click must be swallowed, or a footprint click would search twice.
    act(() => stub.handlers.objectClicked({ data: { obsId: 'b' } }));
    expect(onClick).toHaveBeenCalledWith('b');
    act(() => stub.handlers.click({ ra: 3, dec: 4, x: 0, y: 0 }));
    expect(onSkyClick).toHaveBeenCalledTimes(1);

    const emphasis = stub.overlays.find((o) => o.name === 'mast-emphasis')!;
    expect(emphasis.items).toHaveLength(0);
    rerender(<SkyMap ref={ref} rows={ROWS} hoverId="a" onHover={onHover} onClick={onClick} />);
    expect(emphasis.items).toHaveLength(1);
    act(() => ref.current!.select(['b']));
    expect(emphasis.items).toHaveLength(2);
    act(() => ref.current!.highlight(null));
    expect(emphasis.items).toHaveLength(1);
  });

  it('exposes goto / fitToResults / getView / setFootprints on the handle', async () => {
    const stub = makeStubA();
    loadAladinMock.mockResolvedValue(stub.A);
    const ref = createRef<SkyMapHandle>();
    render(<SkyMap ref={ref} autoFit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());
    expect(stub.aladin.gotoRaDec).not.toHaveBeenCalled();

    act(() => ref.current!.goto(83.8, -5.4, 2));
    expect(stub.aladin.gotoRaDec).toHaveBeenCalledWith(83.8, -5.4);
    expect(stub.aladin.setFoV).toHaveBeenCalledWith(2);
    expect(ref.current!.getView()).toEqual({ ra: 10, dec: 20, fov: 60 });

    act(() => ref.current!.setFootprints(ROWS));
    const footprints = stub.overlays.find((o) => o.name === 'mast-footprints')!;
    expect(footprints.items).toHaveLength(2);
    stub.aladin.gotoRaDec.mockClear();
    act(() => ref.current!.fitToResults());
    expect(stub.aladin.gotoRaDec).toHaveBeenCalledTimes(1);
  });

  it('switches survey, persists it, and shows a banner when the survey fails to load', async () => {
    const stub = makeStubA();
    loadAladinMock.mockResolvedValue(stub.A);
    render(<SkyMap />);
    const select = await screen.findByLabelText('Background survey');
    expect(stub.aladin.setBaseImageLayer).toHaveBeenCalledTimes(1);
    act(() => {
      (select as HTMLSelectElement).value = 'P/2MASS/color';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(stub.aladin.setBaseImageLayer).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem('mast_sky_survey')).toBe('P/2MASS/color');
    const call = stub.A.HiPS.mock.calls[stub.A.HiPS.mock.calls.length - 1];
    expect(call[0]).toBe('P/2MASS/color');
    act(() => (call[1] as { errorCallback: () => void }).errorCallback());
    expect(await screen.findByText(/Sky imagery unavailable/)).toBeInTheDocument();
  });

  it('draws the coverage grid as density-tiered MOCs', async () => {
    const stub = makeStubA();
    loadAladinMock.mockResolvedValue(stub.A);
    render(
      <SkyMap
        coverage={{
          nside: 64,
          cells: [
            [1, 1],
            [2, 5],
            [3, 50],
          ],
        }}
      />
    );
    await waitFor(() => expect(stub.aladin.addMOC).toHaveBeenCalledTimes(3));
    const jsons = stub.A.MOCFromJSON.mock.calls.map((c) => c[0]);
    expect(jsons).toEqual([{ '6': [3] }, { '6': [2] }, { '6': [1] }]);
  });

  it('coverageTiers buckets by count and drops empty tiers', () => {
    const tiers = coverageTiers({ nside: 32, cells: [[7, 2]] });
    expect(tiers).toEqual([{ json: { '5': [7] }, opacity: 0.2 }]);
  });

  describe('draw-to-search (Phase 6)', () => {
    async function renderWithDraw(extra: Record<string, unknown> = {}) {
      const stub = makeStubA();
      loadAladinMock.mockResolvedValue(stub.A);
      const onRegionDrawn = vi.fn();
      render(<SkyMap onRegionDrawn={onRegionDrawn} {...extra} />);
      await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());
      return { stub, onRegionDrawn };
    }

    it('shows no draw buttons without onRegionDrawn', async () => {
      const stub = makeStubA();
      loadAladinMock.mockResolvedValue(stub.A);
      render(<SkyMap />);
      await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Circle' })).toBeNull();
    });

    it('circle draw: converts the pixel selection and reports a circle region', async () => {
      const { stub, onRegionDrawn } = await renderWithDraw();
      fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
      expect(stub.aladin.select).toHaveBeenCalledWith('circle', expect.any(Function));
      const cb = stub.aladin.select.mock.calls[0][1] as (sel: unknown) => void;
      act(() => cb({ x: 100, y: 50, r: 20 }));
      expect(onRegionDrawn).toHaveBeenCalledWith({ kind: 'circle', ra: 10, dec: 5, r: 2 });
      // Draw mode ended: the hint is gone.
      expect(screen.queryByText(/draw a circle/i)).toBeNull();
    });

    it('polygon draw: converts vertices and drops the repeated closing vertex', async () => {
      const { stub, onRegionDrawn } = await renderWithDraw();
      fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
      expect(stub.aladin.select).toHaveBeenCalledWith('poly', expect.any(Function));
      const cb = stub.aladin.select.mock.calls[0][1] as (sel: unknown) => void;
      act(() =>
        cb({
          vertices: [
            { x: 100, y: 50 },
            { x: 110, y: 50 },
            { x: 105, y: 60 },
            { x: 105, y: 60 },
          ],
        })
      );
      expect(onRegionDrawn).toHaveBeenCalledWith({
        kind: 'polygon',
        vertices: [
          { ra: 10, dec: 5 },
          { ra: 11, dec: 5 },
          { ra: 10.5, dec: 6 },
        ],
      });
    });

    it('a degenerate polygon (fewer than 3 distinct vertices) reports nothing', async () => {
      const { stub, onRegionDrawn } = await renderWithDraw();
      fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
      const cb = stub.aladin.select.mock.calls[0][1] as (sel: unknown) => void;
      act(() =>
        cb({
          vertices: [
            { x: 1, y: 1 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        })
      );
      expect(onRegionDrawn).not.toHaveBeenCalled();
    });

    it('Escape cancels the draw via fire("default")', async () => {
      const { stub, onRegionDrawn } = await renderWithDraw();
      fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
      expect(screen.getByText(/click to add vertices/i)).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(stub.aladin.fire).toHaveBeenCalledWith('default');
      expect(onRegionDrawn).not.toHaveBeenCalled();
      expect(screen.queryByText(/click to add vertices/i)).toBeNull();
    });

    it('renders the region prop on its own overlay and Clear reports onRegionClear', async () => {
      const stub = makeStubA();
      loadAladinMock.mockResolvedValue(stub.A);
      const onRegionClear = vi.fn();
      stub.A.circle.mockReturnValue({ kind: 'stub-circle' });
      render(
        <SkyMap
          onRegionDrawn={vi.fn()}
          onRegionClear={onRegionClear}
          region={{ kind: 'circle', ra: 10, dec: 5, r: 2 }}
        />
      );
      await waitFor(() => expect(screen.getByLabelText('Background survey')).toBeInTheDocument());
      expect(stub.A.circle).toHaveBeenCalledWith(10, 5, 2, expect.any(Object));
      const regionOverlay = stub.overlays.find((o) => o.name === 'mast-region');
      expect(regionOverlay?.items).toContainEqual({ kind: 'stub-circle' });
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onRegionClear).toHaveBeenCalled();
    });
  });
});
