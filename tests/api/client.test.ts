import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import {
  CompanyNotFoundError,
  InvalidInputError,
  RateLimitedError,
  ApiUnavailableError,
} from '../../src/shared/errors.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Fixtures ---

const COMPANY_PROFILE_FIXTURE = {
  can_file: true,
  company_name: 'TEST COMPANY LTD',
  company_number: '12345678',
  company_status: 'active',
  date_of_creation: '2020-01-01',
  links: { self: '/company/12345678' },
  type: 'ltd',
  sic_codes: ['62020'],
  registered_office_address: {
    address_line_1: '1 Test Street',
    locality: 'London',
    postal_code: 'EC1A 1BB',
  },
};

const SEARCH_RESULT_FIXTURE = {
  items: [
    {
      company_number: '12345678',
      title: 'TEST COMPANY LTD',
      company_status: 'active',
      company_type: 'ltd',
      date_of_creation: '2020-01-01',
      address_snippet: '1 Test Street, London, EC1A 1BB',
      kind: 'searchresults#company',
    },
  ],
  items_per_page: 20,
  start_index: 0,
  total_results: 1,
};

const OFFICER_LIST_FIXTURE = {
  active_count: 1,
  items: [
    {
      name: 'SMITH, John',
      officer_role: 'director',
      appointed_on: '2020-01-01',
      links: { self: '/officers/abc123' },
    },
  ],
  items_per_page: 35,
  resigned_count: 0,
  start_index: 0,
  total_results: 1,
};

// --- Helpers ---

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('ChApiClient', () => {
  let cache: CacheStore;
  let dbPath: string;
  let client: ChApiClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ch-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    cache = new CacheStore(dbPath);

    const rateLimiter = new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 });

    client = new ChApiClient({
      apiKey: 'test-api-key',
      cache,
      rateLimiter,
    });

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cache.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
    }
  });

  describe('getCompanyProfile', () => {
    it('fetches and caches a company profile', async () => {
      globalThis.fetch = mockFetch(200, COMPANY_PROFILE_FIXTURE);

      const result = await client.getCompanyProfile('12345678');

      expect(result.data.company_name).toBe('TEST COMPANY LTD');
      expect(result.stale).toBe(false);
      expect(result.source).toBe('api');
      expect(globalThis.fetch).toHaveBeenCalledOnce();

      // Second call should hit cache
      const cached = await client.getCompanyProfile('12345678');
      expect(cached.source).toBe('cache');
      expect(globalThis.fetch).toHaveBeenCalledOnce(); // no new fetch
    });

    it('throws CompanyNotFoundError on 404', async () => {
      globalThis.fetch = mockFetch(404, { errors: [{ type: 'ch:service', error: 'company-profile-not-found' }] });

      await expect(client.getCompanyProfile('99999999')).rejects.toThrow(CompanyNotFoundError);
    });

    it('throws InvalidInputError for bad company number', async () => {
      await expect(client.getCompanyProfile('abc')).rejects.toThrow(InvalidInputError);
      await expect(client.getCompanyProfile('123')).rejects.toThrow(InvalidInputError);
      await expect(client.getCompanyProfile('')).rejects.toThrow(InvalidInputError);
    });

    it('accepts Scottish company numbers', async () => {
      globalThis.fetch = mockFetch(200, {
        ...COMPANY_PROFILE_FIXTURE,
        company_number: 'SC123456',
      });

      const result = await client.getCompanyProfile('SC123456');
      expect(result.data.company_number).toBe('SC123456');
    });

    it('serves stale cache on 429', async () => {
      // Prime the cache
      globalThis.fetch = mockFetch(200, COMPANY_PROFILE_FIXTURE);
      await client.getCompanyProfile('12345678');

      // Manually stale the cache
      const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare('UPDATE cache SET fetched_at = fetched_at - 100000').run();

      // Return 429
      globalThis.fetch = mockFetch(429, {});

      const result = await client.getCompanyProfile('12345678');
      expect(result.stale).toBe(true);
      expect(result.source).toBe('cache');
    });

    it('throws RateLimitedError on 429 with no cache', async () => {
      globalThis.fetch = mockFetch(429, {});
      await expect(client.getCompanyProfile('12345678')).rejects.toThrow(RateLimitedError);
    });

    it('serves stale cache on 5xx', async () => {
      // Prime cache
      globalThis.fetch = mockFetch(200, COMPANY_PROFILE_FIXTURE);
      await client.getCompanyProfile('12345678');

      // Stale the cache
      const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare('UPDATE cache SET fetched_at = fetched_at - 100000').run();

      // Return 500
      globalThis.fetch = mockFetch(500, {});

      const result = await client.getCompanyProfile('12345678');
      expect(result.stale).toBe(true);
      expect(result.source).toBe('cache');
    });

    it('throws ApiUnavailableError on 5xx with no cache', async () => {
      globalThis.fetch = mockFetch(500, {});
      await expect(client.getCompanyProfile('12345678')).rejects.toThrow(ApiUnavailableError);
    });

    it('serves stale cache on network error', async () => {
      // Prime cache
      globalThis.fetch = mockFetch(200, COMPANY_PROFILE_FIXTURE);
      await client.getCompanyProfile('12345678');

      // Stale the cache
      const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare('UPDATE cache SET fetched_at = fetched_at - 100000').run();

      // Throw network error
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.getCompanyProfile('12345678');
      expect(result.stale).toBe(true);
      expect(result.source).toBe('cache');
    });
  });

  describe('searchCompanies', () => {
    it('searches companies', async () => {
      globalThis.fetch = mockFetch(200, SEARCH_RESULT_FIXTURE);

      const result = await client.searchCompanies('test company');
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].title).toBe('TEST COMPANY LTD');
    });

    it('throws on empty query', async () => {
      await expect(client.searchCompanies('')).rejects.toThrow(InvalidInputError);
      await expect(client.searchCompanies('  ')).rejects.toThrow(InvalidInputError);
    });
  });

  describe('getOfficers', () => {
    it('fetches officers', async () => {
      globalThis.fetch = mockFetch(200, OFFICER_LIST_FIXTURE);

      const result = await client.getOfficers('12345678');
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].name).toBe('SMITH, John');
    });
  });

  describe('getOfficerAppointments', () => {
    it('throws on empty officer ID', async () => {
      await expect(client.getOfficerAppointments('')).rejects.toThrow(InvalidInputError);
    });

    it('fetches appointments', async () => {
      globalThis.fetch = mockFetch(200, {
        items: [
          {
            name: 'SMITH, John',
            officer_role: 'director',
            appointed_on: '2020-01-01',
            appointed_to: { company_name: 'TEST LTD', company_number: '12345678', company_status: 'active' },
          },
        ],
        items_per_page: 50,
        start_index: 0,
        total_results: 1,
      });

      const result = await client.getOfficerAppointments('abc123def');
      expect(result.data.items).toHaveLength(1);
    });
  });

  describe('error responses', () => {
    it('throws descriptive error on 401 (invalid API key)', async () => {
      globalThis.fetch = mockFetch(401, { error: 'Invalid authentication credentials' });

      await expect(client.getCompanyProfile('12345678')).rejects.toThrow('Invalid or expired API key');
    });

    it('throws descriptive error on 403 (forbidden)', async () => {
      globalThis.fetch = mockFetch(403, { error: 'Forbidden' });

      await expect(client.getCompanyProfile('12345678')).rejects.toThrow('does not have access');
    });
  });

  describe('auth header', () => {
    it('sends correct basic auth', async () => {
      const fetchSpy = mockFetch(200, COMPANY_PROFILE_FIXTURE);
      globalThis.fetch = fetchSpy;

      await client.getCompanyProfile('12345678');

      const callArgs = fetchSpy.mock.calls[0];
      const headers = callArgs[1].headers;
      const expected = 'Basic ' + Buffer.from('test-api-key:').toString('base64');
      expect(headers.Authorization).toBe(expected);
    });
  });
});
