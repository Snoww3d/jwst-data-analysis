import { describe, it, expect } from 'vitest';
import { isValidObjectId } from './validationUtils';

describe('isValidObjectId', () => {
  describe('valid 24-char hex strings', () => {
    it('accepts lowercase hex', () => {
      expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    });

    it('accepts uppercase hex', () => {
      expect(isValidObjectId('507F1F77BCF86CD799439011')).toBe(true);
    });

    it('accepts mixed case hex', () => {
      expect(isValidObjectId('507f1F77bcF86cD799439011')).toBe(true);
    });

    it('accepts all zeros', () => {
      expect(isValidObjectId('000000000000000000000000')).toBe(true);
    });

    it('accepts all f characters', () => {
      expect(isValidObjectId('ffffffffffffffffffffffff')).toBe(true);
    });

    it('accepts digits only', () => {
      expect(isValidObjectId('123456789012345678901234')).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects 23-char string (too short)', () => {
      expect(isValidObjectId('507f1f77bcf86cd79943901')).toBe(false);
    });

    it('rejects 25-char string (too long)', () => {
      expect(isValidObjectId('507f1f77bcf86cd7994390111')).toBe(false);
    });

    it('rejects non-hex characters (g)', () => {
      expect(isValidObjectId('507f1f77bcf86cd79943901g')).toBe(false);
    });

    it('rejects non-hex characters (z)', () => {
      expect(isValidObjectId('507f1f77bcf86cd79943901z')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidObjectId('')).toBe(false);
    });

    it('rejects string with spaces', () => {
      expect(isValidObjectId('507f1f77bcf86cd7 9439011')).toBe(false);
    });

    it('rejects string with special characters', () => {
      expect(isValidObjectId('507f1f77bcf86cd79943901!')).toBe(false);
    });

    it('rejects string with dashes', () => {
      expect(isValidObjectId('507f-1f77-bcf8-6cd7-9943')).toBe(false);
    });
  });
});
