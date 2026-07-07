import { describe, it, expect } from 'vitest';
import { ApiError } from '../services/ApiError';
import { describeTransientCompositeError } from './compositeErrors';

describe('describeTransientCompositeError', () => {
  it('maps 429 to the renderer-busy message', () => {
    const result = describeTransientCompositeError(new ApiError('x', 429, 'Too Many Requests'));
    expect(result?.title).toBe('Renderer busy');
    expect(result?.message).toMatch(/busy right now/);
    expect(result?.message).toMatch(/try again/);
  });

  it.each([503, 504])('maps %d to the timeout message', (status) => {
    const result = describeTransientCompositeError(new ApiError('x', status, 'gateway'));
    expect(result?.title).toBe("Render didn't finish");
    expect(result?.message).toMatch(/took longer than expected/);
  });

  it('maps fetch network failures (TypeError) to the timeout message', () => {
    expect(describeTransientCompositeError(new TypeError('Failed to fetch'))?.message).toMatch(
      /took longer than expected/
    );
  });

  it('returns null for non-transient errors so callers keep their handling', () => {
    expect(describeTransientCompositeError(new ApiError('x', 413, 'too large'))).toBeNull();
    expect(describeTransientCompositeError(new ApiError('x', 404, 'nf'))).toBeNull();
    expect(describeTransientCompositeError(new Error('boom'))).toBeNull();
    expect(describeTransientCompositeError('weird')).toBeNull();
  });
});
