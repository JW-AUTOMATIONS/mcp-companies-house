import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCompanyProfile } from '../../src/tools/get-company-profile.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function setup() {
  const dbPath = path.join(os.tmpdir(), `ch-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const cache = new CacheStore(dbPath);
  const client = new ChApiClient({
    apiKey: 'test',
    cache,
    rateLimiter: new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 }),
  });
  return { client, cache, dbPath };
}

function cleanup(cache: CacheStore, dbPath: string) {
  cache.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

const FULL_PROFILE = {
  can_file: true,
  company_name: 'ACME TECHNOLOGIES LTD',
  company_number: '12345678',
  company_status: 'active',
  date_of_creation: '2018-06-15',
  type: 'ltd',
  jurisdiction: 'england-wales',
  links: { self: '/company/12345678' },
  sic_codes: ['62020'],
  has_charges: true,
  has_insolvency_history: false,
  registered_office_address: {
    address_line_1: '10 Downing Street',
    locality: 'London',
    postal_code: 'SW1A 2AA',
    country: 'United Kingdom',
  },
  accounts: {
    next_accounts: { due_on: '2026-03-31', overdue: false },
    last_accounts: { made_up_to: '2025-06-15' },
  },
  confirmation_statement: {
    next_due: '2026-06-29',
    next_made_up_to: '2026-06-15',
    overdue: false,
  },
  previous_company_names: [
    { name: 'OLD NAME LTD', effective_from: '2018-06-15', ceased_on: '2020-01-01' },
  ],
};

describe('getCompanyProfile', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns a structured company profile', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(FULL_PROFILE) })
    );

    try {
      const result = await getCompanyProfile(client, { company_number: '12345678' });

      expect(result.company_name).toBe('ACME TECHNOLOGIES LTD');
      expect(result.status).toBe('active');
      expect(result.sector).toBe('Technology & Software');
      expect(result.sic_codes).toEqual(['62020']);
      expect(result.has_charges).toBe(true);
      expect(result.has_insolvency_history).toBe(false);
      expect(result.accounts.next_due).toBe('2026-03-31');
      expect(result.accounts.overdue).toBe(false);
      expect(result.confirmation_statement.next_due).toBe('2026-06-29');
      expect(result.previous_names).toHaveLength(1);
      expect(result.previous_names[0]).toContain('OLD NAME LTD');
      expect(result.age_years).toBeGreaterThan(0);
      expect(result.registered_address).toContain('Downing Street');
      expect(result.attribution).toContain('Open Government Licence');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('normalizes short company numbers', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      expect(url).toContain('/company/00123456');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        ...FULL_PROFILE, company_number: '00123456',
      }) });
    });

    try {
      const result = await getCompanyProfile(client, { company_number: '123456' });
      expect(result.company_number).toBe('00123456');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('handles minimal profile data gracefully', async () => {
    const { client, cache, dbPath } = setup();

    const minimalProfile = {
      can_file: false,
      company_name: 'MINIMAL LTD',
      company_number: '99999999',
      company_status: 'dissolved',
      type: 'ltd',
      links: { self: '/company/99999999' },
    };

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(minimalProfile) })
    );

    try {
      const result = await getCompanyProfile(client, { company_number: '99999999' });

      expect(result.company_name).toBe('MINIMAL LTD');
      expect(result.status).toBe('dissolved');
      expect(result.date_of_creation).toBeNull();
      expect(result.age_years).toBeNull();
      expect(result.sic_codes).toEqual([]);
      expect(result.has_charges).toBe(false);
      expect(result.accounts.next_due).toBeNull();
      expect(result.previous_names).toEqual([]);
    } finally {
      cleanup(cache, dbPath);
    }
  });
});
