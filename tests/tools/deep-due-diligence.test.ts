import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deepDueDiligence } from '../../src/tools/deep-due-diligence.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import { CompanyNotFoundError } from '../../src/shared/errors.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROFILE = {
  can_file: true,
  company_name: 'ACME LTD',
  company_number: '12345678',
  company_status: 'active',
  date_of_creation: '2018-03-15',
  links: {
    self: '/company/12345678',
    officers: '/company/12345678/officers',
    persons_with_significant_control: '/company/12345678/persons-with-significant-control',
    filing_history: '/company/12345678/filing-history',
  },
  type: 'ltd',
  sic_codes: ['62020', '62090'],
  registered_office_address: {
    address_line_1: '10 Downing Street',
    locality: 'London',
    postal_code: 'SW1A 2AA',
    country: 'England',
  },
  jurisdiction: 'england-wales',
};

const OFFICERS = {
  active_count: 2,
  items: [
    {
      name: 'SMITH, John',
      officer_role: 'director',
      appointed_on: '2018-03-15',
      nationality: 'British',
      occupation: 'Software Engineer',
      links: { self: '/officers/abc123', officer: { appointments: '/officers/abc123/appointments' } },
    },
    {
      name: 'DOE, Jane',
      officer_role: 'secretary',
      appointed_on: '2019-01-01',
      resigned_on: '2022-06-01',
      links: { self: '/officers/def456' },
    },
  ],
  items_per_page: 35,
  resigned_count: 1,
  start_index: 0,
  total_results: 2,
};

const PSCS = {
  active_count: 1,
  ceased_count: 0,
  items: [
    {
      name: 'Mr John Smith',
      natures_of_control: ['ownership-of-shares-75-to-100-percent'],
      notified_on: '2018-03-15',
      kind: 'individual-person-with-significant-control',
    },
  ],
  items_per_page: 25,
  start_index: 0,
  total_results: 1,
};

const FILINGS = {
  items: [
    { category: 'accounts', date: '2025-09-15', description: 'full accounts', transaction_id: 't1', type: 'AA' },
    { category: 'confirmation-statement', date: '2025-03-20', description: 'confirmation', transaction_id: 't2', type: 'CS01' },
  ],
  items_per_page: 25,
  start_index: 0,
  total_count: 2,
};

function makeClient(): { client: ChApiClient; cache: CacheStore; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `ch-dd-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const cache = new CacheStore(dbPath);
  const client = new ChApiClient({
    apiKey: 'test',
    cache,
    rateLimiter: new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 }),
  });
  return { client, cache, dbPath };
}

function cleanupDb(cache: CacheStore, dbPath: string) {
  cache.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

describe('deepDueDiligence', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('assembles a complete due diligence report', async () => {
    const { client, cache, dbPath } = makeClient();

    // Mock API calls routed by URL path
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      let status = 200;

      if (url.includes('/company/12345678/officers')) {
        body = OFFICERS;
      } else if (url.includes('/company/12345678/persons-with-significant-control')) {
        body = PSCS;
      } else if (url.includes('/company/12345678/filing-history')) {
        body = FILINGS;
      } else if (url.includes('/company/12345678/charges')) {
        body = { items: [], total_count: 0 };
      } else if (url.includes('/company/12345678/insolvency')) {
        body = { cases: [] };
      } else if (url.includes('/company/12345678')) {
        body = PROFILE;
      }

      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    });

    try {
      const result = await deepDueDiligence(client, { company_number: '12345678' });

      expect(result.company.name).toBe('ACME LTD');
      expect(result.company.number).toBe('12345678');
      expect(result.company.status).toBe('active');
      expect(result.company.sector).toBe('Technology & Software');
      expect(result.company.sectors).toContain('Technology & Software');
      expect(result.company.sic_codes).toEqual(['62020', '62090']);
      expect(result.company.registered_address).toContain('Downing Street');

      expect(result.officers.current).toHaveLength(1);
      expect(result.officers.current[0].name).toBe('SMITH, John');
      expect(result.officers.current[0].officer_id).toBe('abc123');
      expect(result.officers.resigned).toHaveLength(1);
      expect(result.officers.resigned[0].name).toBe('DOE, Jane');

      expect(result.pscs).toHaveLength(1);
      expect(result.pscs[0].is_corporate).toBe(false);

      expect(result.recent_filings.length).toBeGreaterThan(0);

      expect(result.risk_summary.overall).toBe('low');

      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('active');
      expect(result.summary).toContain('year-old');
      expect(result.summary).toContain('low risk');
      expect(result.summary).toContain('2 active directors');
      expect(result.summary).toContain('no charges');

      expect(result.attribution).toContain('Open Government Licence');
    } finally {
      cleanupDb(cache, dbPath);
    }
  });

  it('throws when company profile is not found', async () => {
    const { client, cache, dbPath } = makeClient();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    try {
      await expect(deepDueDiligence(client, { company_number: '99999999' }))
        .rejects.toThrow(CompanyNotFoundError);
    } finally {
      cleanupDb(cache, dbPath);
    }
  });

  it('summary handles dissolved company with no active directors', async () => {
    const { client, cache, dbPath } = makeClient();

    const dissolvedProfile = {
      ...PROFILE,
      company_status: 'dissolved',
      date_of_cessation: '2024-06-01',
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/officers')) {
        body = { active_count: 0, items: [], items_per_page: 35, resigned_count: 0, start_index: 0, total_results: 0 };
      } else if (url.includes('/persons-with-significant-control')) {
        body = { active_count: 0, ceased_count: 0, items: [], items_per_page: 25, start_index: 0, total_results: 0 };
      } else if (url.includes('/filing-history')) {
        body = { items: [], items_per_page: 25, start_index: 0, total_count: 0 };
      } else if (url.includes('/charges')) {
        body = { items: [], total_count: 0 };
      } else if (url.includes('/insolvency')) {
        body = { cases: [] };
      } else {
        body = dissolvedProfile;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await deepDueDiligence(client, { company_number: '12345678' });
      expect(result.summary).toContain('dissolved');
      expect(result.summary).toContain('2024-06-01');
      expect(result.summary).toContain('no active directors');
    } finally {
      cleanupDb(cache, dbPath);
    }
  });

  it('degrades gracefully when sub-resources fail', async () => {
    const { client, cache, dbPath } = makeClient();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/company/12345678')) {
        // Profile succeeds
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(PROFILE),
        });
      }
      // Everything else 404s
      return Promise.resolve({
        ok: false, status: 404,
        json: () => Promise.resolve({}),
      });
    });

    try {
      const result = await deepDueDiligence(client, { company_number: '12345678' });

      expect(result.company.name).toBe('ACME LTD');
      expect(result.officers.current).toHaveLength(0);
      expect(result.officers.resigned).toHaveLength(0);
      expect(result.pscs).toHaveLength(0);
      expect(result.charges).toHaveLength(0);
      expect(result.insolvency_cases).toHaveLength(0);
      expect(result.recent_filings).toHaveLength(0);
    } finally {
      cleanupDb(cache, dbPath);
    }
  });
});
