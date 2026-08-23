import type { AladinStatic } from '../types/aladin-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AladinLoadError,
  DEFAULT_ALADIN_URL,
  aladinUrl,
  loadAladin,
  resetAladinLoader,
} from './loadAladin';

function stubWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    available && type === 'webgl2' ? ({} as RenderingContext) : null) as never);
}

function fakeA(init: Promise<void> = Promise.resolve()): AladinStatic {
  return { init } as unknown as AladinStatic;
}

describe('loadAladin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAladinLoader();
    delete window.A;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetAladinLoader();
    delete window.A;
  });

  it('rejects without WebGL2 before injecting a script', async () => {
    stubWebGL(false);
    const p = loadAladin();
    await expect(p).rejects.toMatchObject({ reason: 'no-webgl' });
    expect(document.querySelector('script[data-aladin-loader]')).toBeNull();
  });

  it('injects the script once, resolves window.A after A.init settles, memoises', async () => {
    stubWebGL(true);
    const p1 = loadAladin();
    const p2 = loadAladin();
    expect(p1).toBe(p2);
    const script = document.querySelector<HTMLScriptElement>('script[data-aladin-loader]');
    expect(script).not.toBeNull();
    expect(script!.src).toBe(DEFAULT_ALADIN_URL);
    expect(document.querySelectorAll('script[data-aladin-loader]')).toHaveLength(1);

    window.A = fakeA();
    script!.dispatchEvent(new Event('load'));
    await expect(p1).resolves.toBe(window.A);
    // a third call after success reuses the resolved promise
    await expect(loadAladin()).resolves.toBe(window.A);
  });

  it('times out and rejects when the script never loads', async () => {
    stubWebGL(true);
    const p = loadAladin({ timeoutMs: 500 });
    const assertion = expect(p).rejects.toBeInstanceOf(AladinLoadError);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
    await expect(p).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('rejects when the script errors, and a later call can retry', async () => {
    stubWebGL(true);
    const p = loadAladin();
    const script = document.querySelector<HTMLScriptElement>('script[data-aladin-loader]')!;
    script.dispatchEvent(new Event('error'));
    await expect(p).rejects.toMatchObject({ reason: 'script-error' });
    // retry injects a fresh tag
    const p2 = loadAladin();
    expect(p2).not.toBe(p);
    const again = document.querySelector<HTMLScriptElement>('script[data-aladin-loader]')!;
    window.A = fakeA();
    again.dispatchEvent(new Event('load'));
    await expect(p2).resolves.toBe(window.A);
  });

  it('maps an A.init rejection (no WebGL2 inside Aladin) to init-failed', async () => {
    stubWebGL(true);
    const rejected = Promise.reject('WebGL2 not supported by your browser');
    rejected.catch(() => undefined);
    window.A = fakeA(rejected);
    await expect(loadAladin()).rejects.toMatchObject({
      reason: 'init-failed',
      message: 'WebGL2 not supported by your browser',
    });
  });

  it('reuses a pre-existing window.A without injecting', async () => {
    stubWebGL(true);
    window.A = fakeA();
    await expect(loadAladin()).resolves.toBe(window.A);
    expect(document.querySelector('script[data-aladin-loader]')).toBeNull();
  });

  it('aladinUrl honours VITE_ALADIN_URL', () => {
    vi.stubEnv('VITE_ALADIN_URL', 'http://localhost:9999/aladin.js');
    expect(aladinUrl()).toBe('http://localhost:9999/aladin.js');
    vi.stubEnv('VITE_ALADIN_URL', '   ');
    expect(aladinUrl()).toBe(DEFAULT_ALADIN_URL);
    vi.unstubAllEnvs();
  });
});
