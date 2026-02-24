import { describe, it, expect } from 'vitest';
import { getStatusColor } from './statusUtils';

describe('getStatusColor', () => {
  it('returns "green" for "completed"', () => {
    expect(getStatusColor('completed')).toBe('green');
  });

  it('returns "orange" for "processing"', () => {
    expect(getStatusColor('processing')).toBe('orange');
  });

  it('returns "red" for "failed"', () => {
    expect(getStatusColor('failed')).toBe('red');
  });

  it('returns "gray" for unknown status "pending"', () => {
    expect(getStatusColor('pending')).toBe('gray');
  });

  it('returns "gray" for empty string', () => {
    expect(getStatusColor('')).toBe('gray');
  });

  it('returns "gray" for arbitrary unknown status', () => {
    expect(getStatusColor('queued')).toBe('gray');
  });

  it('is case-sensitive — "Completed" returns "gray"', () => {
    expect(getStatusColor('Completed')).toBe('gray');
  });

  it('is case-sensitive — "FAILED" returns "gray"', () => {
    expect(getStatusColor('FAILED')).toBe('gray');
  });
});
