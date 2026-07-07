import { ApiError } from '../services/ApiError';

/**
 * Friendly copy for transient composite-render failures (CE plan Phase 3).
 *
 * The CE deployment fronts the sync render endpoint with a concurrency
 * semaphore (429 when busy) and an nginx request timeout (503/504). A
 * stranger's very first composite failing with a raw status line is the
 * worst possible CE moment — these map to a calm "try again" message.
 * Returns null for anything that isn't a transient/busy condition so the
 * caller falls through to its existing error handling.
 */
export interface TransientCompositeError {
  title: string;
  message: string;
}

const BUSY: TransientCompositeError = {
  title: 'Renderer busy',
  message:
    'The image renderer is busy right now — please try again in a moment. ' +
    'Your recipe and settings are kept.',
};

const TIMED_OUT: TransientCompositeError = {
  title: "Render didn't finish",
  message:
    'The render took longer than expected and was stopped. Please try again — ' +
    'if it keeps happening, try a recipe with fewer filters.',
};

export function describeTransientCompositeError(err: unknown): TransientCompositeError | null {
  if (ApiError.isApiError(err)) {
    if (err.status === 429) return BUSY;
    if (err.status === 503 || err.status === 504) return TIMED_OUT;
    return null;
  }
  // fetch() network failure (connection dropped mid-render / proxy cut)
  if (err instanceof TypeError) return TIMED_OUT;
  return null;
}
