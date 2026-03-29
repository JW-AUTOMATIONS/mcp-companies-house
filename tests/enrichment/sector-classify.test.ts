import { describe, it, expect } from 'vitest';
import { classifySector, classifySectors } from '../../src/enrichment/sector-classify.js';

describe('classifySector', () => {
  it('classifies technology SIC codes', () => {
    expect(classifySector(['62020'])).toBe('Technology & Software');
    expect(classifySector(['62090'])).toBe('Technology & Software');
  });

  it('classifies financial services', () => {
    expect(classifySector(['64110'])).toBe('Financial Services');
  });

  it('classifies construction', () => {
    expect(classifySector(['41100'])).toBe('Construction - Buildings');
    expect(classifySector(['43210'])).toBe('Specialist Construction');
  });

  it('classifies retail', () => {
    expect(classifySector(['47110'])).toBe('Retail Trade');
  });

  it('returns Unknown for empty/missing SIC codes', () => {
    expect(classifySector(undefined)).toBe('Unknown');
    expect(classifySector([])).toBe('Unknown');
  });

  it('returns Other for unrecognised SIC prefix', () => {
    expect(classifySector(['00000'])).toBe('Other');
  });

  it('uses first SIC code as primary', () => {
    expect(classifySector(['62020', '47110'])).toBe('Technology & Software');
  });
});

describe('classifySectors', () => {
  it('returns all unique sectors for multiple SIC codes', () => {
    const sectors = classifySectors(['62020', '47110', '62090']);
    expect(sectors).toContain('Technology & Software');
    expect(sectors).toContain('Retail Trade');
    expect(sectors).toHaveLength(2); // 62020 and 62090 both map to Technology
  });

  it('returns Unknown for empty input', () => {
    expect(classifySectors(undefined)).toEqual(['Unknown']);
    expect(classifySectors([])).toEqual(['Unknown']);
  });
});
