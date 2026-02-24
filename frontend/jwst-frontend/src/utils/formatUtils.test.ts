import { describe, it, expect } from 'vitest';
import { formatFileSize } from './formatUtils';

describe('formatFileSize', () => {
  describe('bytes range (< 1024)', () => {
    it('returns "0 bytes" for 0', () => {
      expect(formatFileSize(0)).toBe('0 bytes');
    });

    it('returns "500 bytes" for 500', () => {
      expect(formatFileSize(500)).toBe('500 bytes');
    });

    it('returns "1023 bytes" for 1023', () => {
      expect(formatFileSize(1023)).toBe('1023 bytes');
    });

    it('returns "1 bytes" for 1', () => {
      expect(formatFileSize(1)).toBe('1 bytes');
    });
  });

  describe('KB range (1024 - 1048575)', () => {
    it('returns "1.00 KB" for exactly 1024', () => {
      expect(formatFileSize(1024)).toBe('1.00 KB');
    });

    it('returns correct KB for 500000', () => {
      expect(formatFileSize(500000)).toBe('488.28 KB');
    });

    it('returns "1023.99 KB" near the MB boundary', () => {
      expect(formatFileSize(1048575)).toBe('1024.00 KB');
    });
  });

  describe('MB range (1048576 - 1073741823)', () => {
    it('returns "1.00 MB" for exactly 1048576', () => {
      expect(formatFileSize(1048576)).toBe('1.00 MB');
    });

    it('returns correct MB for 500000000', () => {
      expect(formatFileSize(500000000)).toBe('476.84 MB');
    });

    it('returns correct MB for 52428800 (50 MB)', () => {
      expect(formatFileSize(52428800)).toBe('50.00 MB');
    });
  });

  describe('GB range (>= 1073741824)', () => {
    it('returns "1.00 GB" for exactly 1073741824', () => {
      expect(formatFileSize(1073741824)).toBe('1.00 GB');
    });

    it('returns correct GB for 5000000000', () => {
      expect(formatFileSize(5000000000)).toBe('4.66 GB');
    });

    it('returns correct GB for 10737418240 (10 GB)', () => {
      expect(formatFileSize(10737418240)).toBe('10.00 GB');
    });
  });
});
