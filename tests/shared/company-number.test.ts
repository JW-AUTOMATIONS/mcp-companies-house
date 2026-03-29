import { describe, it, expect } from 'vitest';
import { normalizeCompanyNumber } from '../../src/shared/company-number.js';

describe('normalizeCompanyNumber', () => {
  it('passes through valid 8-digit numbers unchanged', () => {
    expect(normalizeCompanyNumber('12345678')).toBe('12345678');
  });

  it('pads short numeric company numbers to 8 digits', () => {
    expect(normalizeCompanyNumber('123456')).toBe('00123456');
    expect(normalizeCompanyNumber('1')).toBe('00000001');
  });

  it('uppercases and passes through valid prefix numbers', () => {
    expect(normalizeCompanyNumber('SC123456')).toBe('SC123456');
    expect(normalizeCompanyNumber('sc123456')).toBe('SC123456');
    expect(normalizeCompanyNumber('NI012345')).toBe('NI012345');
  });

  it('pads short prefix numbers', () => {
    expect(normalizeCompanyNumber('SC12345')).toBe('SC012345');
    expect(normalizeCompanyNumber('OC1')).toBe('OC000001');
  });

  it('trims whitespace', () => {
    expect(normalizeCompanyNumber('  12345678  ')).toBe('12345678');
  });

  it('throws on numbers that are too long', () => {
    expect(() => normalizeCompanyNumber('123456789')).toThrow('too long');
  });

  it('throws on invalid format', () => {
    expect(() => normalizeCompanyNumber('ABCDEFGH')).toThrow('Invalid');
    expect(() => normalizeCompanyNumber('')).toThrow('Invalid');
    expect(() => normalizeCompanyNumber('XX1234567')).toThrow('Invalid');
  });
});
