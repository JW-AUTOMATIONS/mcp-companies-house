import { describe, it, expect } from 'vitest';
import { CacheCategory, getTtlSeconds } from '../../src/cache/ttl.js';

describe('getTtlSeconds', () => {
  it('returns default TTL for free tier', () => {
    expect(getTtlSeconds(CacheCategory.COMPANY_PROFILE, false)).toBe(86_400);
    expect(getTtlSeconds(CacheCategory.FILING_HISTORY, false)).toBe(3_600);
    expect(getTtlSeconds(CacheCategory.SEARCH, false)).toBe(1_800);
  });

  it('returns shorter TTL for pro tier', () => {
    expect(getTtlSeconds(CacheCategory.COMPANY_PROFILE, true)).toBe(43_200);
    expect(getTtlSeconds(CacheCategory.FILING_HISTORY, true)).toBe(1_800);
    expect(getTtlSeconds(CacheCategory.SEARCH, true)).toBe(900);
  });

  it('pro TTL is always <= free TTL', () => {
    for (const category of Object.values(CacheCategory)) {
      const freeTtl = getTtlSeconds(category, false);
      const proTtl = getTtlSeconds(category, true);
      expect(proTtl).toBeLessThanOrEqual(freeTtl);
    }
  });
});
