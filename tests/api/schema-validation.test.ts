import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompanyProfileSchema,
  OfficerListSchema,
  ChargeListSchema,
  FilingHistoryListSchema,
  PscListSchema,
  CompanyInsolvencySchema,
} from '../../src/api/types.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'));
}

describe('Zod schemas against real API responses', () => {
  describe('CompanyProfileSchema', () => {
    it('parses Tesco PLC (large plc, complex history)', () => {
      const data = loadFixture('profile-tesco.json');
      const result = CompanyProfileSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.company_name).toBe('TESCO PLC');
      expect(result.data?.type).toBe('plc');
      expect(result.data?.previous_company_names).toBeDefined();
      expect(result.data?.previous_company_names!.length).toBeGreaterThan(0);
    });

    it('parses an LLP (different company type)', () => {
      const data = loadFixture('profile-llp.json');
      const result = CompanyProfileSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('llp');
    });
  });

  describe('OfficerListSchema', () => {
    it('parses Tesco officers (mix of active and resigned)', () => {
      const data = loadFixture('officers-tesco.json');
      const result = OfficerListSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThan(0);
      expect(result.data?.active_count).toBeGreaterThan(0);
    });
  });

  describe('ChargeListSchema', () => {
    it('parses Tesco charges (single-object particulars/classification)', () => {
      const data = loadFixture('charges-tesco.json');
      const result = ChargeListSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThan(0);
      expect(result.data?.items[0].status).toBeDefined();
    });

    it('handles empty charges list', () => {
      const data = { total_count: 0, unfiltered_count: 0, satisfied_count: 0, part_satisfied_count: 0, items: [] };
      const result = ChargeListSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data?.items).toHaveLength(0);
    });
  });

  describe('FilingHistoryListSchema', () => {
    it('parses 100 Tesco filings (mixed types, capital arrays, resolutions)', () => {
      const data = loadFixture('filings-tesco.json');
      const result = FilingHistoryListSchema.safeParse(data);
      if (!result.success) {
        console.error('First 3 validation errors:', JSON.stringify(result.error.issues.slice(0, 3), null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBe(100);
    });

    it('parses Carillion filings (insolvency filings, subcategory arrays)', () => {
      const data = loadFixture('filings-carillion.json');
      const result = FilingHistoryListSchema.safeParse(data);
      if (!result.success) {
        console.error('First 3 validation errors:', JSON.stringify(result.error.issues.slice(0, 3), null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBe(100);
    });
  });

  describe('CompanyInsolvencySchema', () => {
    it('parses Carillion insolvency (compulsory liquidation, single practitioner)', () => {
      const data = loadFixture('insolvency-carillion.json');
      const result = CompanyInsolvencySchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.cases.length).toBeGreaterThan(0);
      expect(result.data?.cases[0].type).toBe('compulsory-liquidation');
      expect(result.data?.cases[0].practitioners.length).toBeGreaterThan(0);
    });
  });

  describe('CompanyProfileSchema (edge cases)', () => {
    it('parses Carillion (in liquidation, has insolvency history)', () => {
      const data = loadFixture('profile-carillion.json');
      const result = CompanyProfileSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.company_status).toBe('liquidation');
      expect(result.data?.has_insolvency_history).toBe(true);
    });
  });

  describe('PscListSchema', () => {
    it('parses Tesco PSCs (empty list — PSC exemption)', () => {
      const data = loadFixture('pscs-tesco.json');
      const result = PscListSchema.safeParse(data);
      if (!result.success) {
        console.error('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
      expect(result.data?.items).toHaveLength(0);
    });
  });
});
