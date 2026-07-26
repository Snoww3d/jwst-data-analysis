/**
 * The run page renders these strings straight into the DOM, so every branch
 * that could produce "NaN", "null", or a negative duration is pinned here
 * rather than through the component — this is where the contract lives.
 */

import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatDuration,
  formatFileCounter,
  isInterrupted,
  parseCurrentStage,
  toMillis,
  wasInterrupted,
} from './runTiming';

describe('toMillis', () => {
  it('parses an ISO timestamp', () => {
    expect(toMillis('2026-07-24T00:00:00Z')).toBe(Date.parse('2026-07-24T00:00:00Z'));
  });

  it.each([null, undefined, '', 'not a date'])('returns null for %o', (input) => {
    expect(toMillis(input)).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'less than a minute'],
    [59_000, 'less than a minute'],
    [60_000, '1 min'],
    [7 * 60_000, '7 min'],
    [59 * 60_000, '59 min'],
    [60 * 60_000, '1h'],
    [72 * 60_000, '1h 12m'],
    [26 * 60 * 60_000, '26h'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('clamps a negative span rather than printing "-3 min"', () => {
    // Engine and browser clocks can disagree; a run cannot have started later
    // than now from the user's point of view.
    expect(formatDuration(-180_000)).toBe('less than a minute');
  });

  it('returns nothing for a non-finite span', () => {
    expect(formatDuration(NaN)).toBe('');
    expect(formatDuration(Infinity)).toBe('');
  });
});

describe('formatAgo', () => {
  it.each([
    [0, 'just now'],
    [59_999, 'just now'],
    [60_000, '1 min ago'],
    [4 * 60_000, '4 min ago'],
    [72 * 60_000, '1h 12m ago'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatAgo(ms)).toBe(expected);
  });

  it('returns nothing for a non-finite span', () => {
    expect(formatAgo(NaN)).toBe('');
  });
});

describe('parseCurrentStage', () => {
  it('splits "stage:step"', () => {
    expect(parseCurrentStage('detector1:jump')).toEqual({ stage: 'detector1', step: 'jump' });
  });

  it('keeps a bare stage name usable', () => {
    expect(parseCurrentStage('image2')).toEqual({ stage: 'image2', step: null });
  });

  it('tolerates extra colons by keeping the remainder as the step', () => {
    expect(parseCurrentStage('image3:outlier:detection')).toEqual({
      stage: 'image3',
      step: 'outlier:detection',
    });
  });

  it.each([
    [null, { stage: null, step: null }],
    [undefined, { stage: null, step: null }],
    ['', { stage: null, step: null }],
    ['   ', { stage: null, step: null }],
    [':', { stage: null, step: null }],
    ['detector1:', { stage: 'detector1', step: null }],
    [':jump', { stage: null, step: 'jump' }],
    ['  detector1 : jump ', { stage: 'detector1', step: 'jump' }],
  ])('degrades on %o', (input, expected) => {
    expect(parseCurrentStage(input)).toEqual(expected);
  });
});

describe('formatFileCounter', () => {
  it('renders a sane counter', () => {
    expect(formatFileCounter(2, 4)).toBe('file 2 of 4');
    expect(formatFileCounter(1, 1)).toBe('file 1 of 1');
  });

  it.each([
    [null, null],
    [null, 4],
    [2, null],
    [undefined, undefined],
    [0, 4],
    [5, 4],
    [-1, 4],
    [2, 0],
    [NaN, 4],
    [2, Infinity],
  ])('shows nothing rather than nonsense for (%o, %o)', (current, total) => {
    expect(formatFileCounter(current, total)).toBeNull();
  });
});

describe('isInterrupted', () => {
  it.each([
    'interrupted by service restart',
    'Engine restarted mid-run',
    'worker shutdown',
    'engine exited unexpectedly',
  ])('recognises %o', (error) => {
    expect(isInterrupted(error)).toBe(true);
  });

  it.each([null, undefined, '', 'Step jump failed: not enough groups', 'CRDS lookup failed'])(
    'does not over-claim on %o',
    (error) => {
      expect(isInterrupted(error)).toBe(false);
    }
  );
});

describe('wasInterrupted', () => {
  it('covers the shape the engine actually records — failed + restart text', () => {
    expect(
      wasInterrupted({
        status: 'failed',
        cancelRequested: false,
        error: 'interrupted by service restart',
      })
    ).toBe(true);
  });

  it('covers a cancel-shaped interruption too', () => {
    expect(
      wasInterrupted({ status: 'cancelled', cancelRequested: false, error: 'engine restarted' })
    ).toBe(true);
  });

  it('never tells a user "nothing you did caused it" when they pressed Cancel', () => {
    // cancelRequested is structured and only the user's route sets it, so it
    // outranks any wording that happens to appear in the error text.
    expect(
      wasInterrupted({ status: 'cancelled', cancelRequested: true, error: 'engine restarted' })
    ).toBe(false);
  });

  it('leaves a genuine pipeline failure alone', () => {
    expect(
      wasInterrupted({ status: 'failed', cancelRequested: false, error: 'jump step diverged' })
    ).toBe(false);
  });

  it('is never true for a successful run', () => {
    expect(wasInterrupted({ status: 'succeeded', cancelRequested: false, error: 'restart' })).toBe(
      false
    );
  });
});
