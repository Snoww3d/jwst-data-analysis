/**
 * Runtime loader for Aladin Lite v3 (MAST Search v2 Phase 5).
 *
 * Aladin is LGPL-3.0; this repo is MIT. Loading it from a script tag at
 * runtime — not bundling it — keeps it a separately-replaceable component,
 * which is what LGPL asks of us. `VITE_ALADIN_URL` overrides the CDN (a CE
 * operator can self-host the bundle on the LAN).
 *
 * The loader injects the tag once, waits for `window.A`, then awaits
 * `A.init` (Aladin v3 compiles its wasm core asynchronously and rejects
 * when WebGL2 is missing). The promise is memoised, so every SkyMap shares
 * one load; a failure is memoised too, until `resetAladinLoader()` (tests).
 */

import type { AladinStatic } from '../types/aladin-lite';

export const DEFAULT_ALADIN_URL =
  'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
export const ALADIN_LOAD_TIMEOUT_MS = 10_000;
const SCRIPT_ATTR = 'data-aladin-loader';

export class AladinLoadError extends Error {
  constructor(
    message: string,
    public readonly reason: 'no-webgl' | 'timeout' | 'script-error' | 'init-failed'
  ) {
    super(message);
    this.name = 'AladinLoadError';
  }
}

export function aladinUrl(): string {
  const configured = import.meta.env.VITE_ALADIN_URL;
  return configured && configured.trim() ? configured.trim() : DEFAULT_ALADIN_URL;
}

/** Aladin v3 needs WebGL2; probe before spending a 3 MB download on it. */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

let pending: Promise<AladinStatic> | null = null;

export interface LoadAladinOptions {
  timeoutMs?: number;
  url?: string;
}

export function loadAladin(options: LoadAladinOptions = {}): Promise<AladinStatic> {
  if (pending) return pending;
  pending = load(options).catch((err) => {
    // Let a later caller retry after a transient failure (the map can be
    // reopened without a reload), but keep one in-flight promise at a time.
    pending = null;
    throw err;
  });
  return pending;
}

/** Tests only: forget the memoised promise and any injected tag. */
export function resetAladinLoader(): void {
  pending = null;
  document.querySelectorAll(`script[${SCRIPT_ATTR}]`).forEach((el) => el.remove());
}

async function load({
  timeoutMs = ALADIN_LOAD_TIMEOUT_MS,
  url = aladinUrl(),
}: LoadAladinOptions): Promise<AladinStatic> {
  if (!hasWebGL2()) {
    throw new AladinLoadError('WebGL2 is not available in this browser', 'no-webgl');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new AladinLoadError(`Aladin did not load within ${timeoutMs / 1000}s`, 'timeout')),
      timeoutMs
    );
  });

  try {
    const A = await Promise.race([injectScript(url), timeout]);
    try {
      await Promise.race([A.init, timeout]);
    } catch (err) {
      if (err instanceof AladinLoadError) throw err;
      throw new AladinLoadError(
        err instanceof Error ? err.message : String(err ?? 'Aladin failed to initialise'),
        'init-failed'
      );
    }
    return A;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function injectScript(url: string): Promise<AladinStatic> {
  if (window.A) return Promise.resolve(window.A);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      if (window.A) resolve(window.A);
      else
        reject(new AladinLoadError('Aladin script loaded but window.A is missing', 'script-error'));
    };
    const onError = () => {
      script.remove();
      reject(new AladinLoadError(`Failed to load Aladin from ${url}`, 'script-error'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.setAttribute(SCRIPT_ATTR, 'true');
      document.head.appendChild(script);
    }
  });
}
