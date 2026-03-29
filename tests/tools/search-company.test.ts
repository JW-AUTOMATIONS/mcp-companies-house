import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchCompany } from '../../src/tools/search-company.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

const SEARCH_FIXTURE = {
  items: [
    {
      company_number: '12345678',
      title: 'ACME TECH LTD',
      company_status: 'active',
      company_type: 'ltd',
      date_of_creation: '2020-06-15',
      address_snippet: '1 High Street, London, EC1A 1BB',
      address: { address_line_1: '1 High Street', locality: 'London', postal_code: 'EC1A 1BB' },
      kind: 'searchresults#company',
    },
    {
      company_number: '87654321',
      title: 'ACME BUILDERS LTD',
      company_status: 'dissolved',
      company_type: 'ltd',
      date_of_creation: '2010-01-01',
      date_of_cessation: '2023-03-01',
      address_snippet: '2 Main Road, Edinburgh, EH1 1AA',
      address: { address_line_1: '2 Main Road', locality: 'Edinburgh', region: 'Scotland', postal_code: 'EH1 1AA' },
      kind: 'searchresults#company',
    },
    {
      company_number: '11111111',
      title: 'ACME SERVICES LTD',
      company_status: 'active',
      company_type: 'ltd',
      date_of_creation: '2022-09-01',
      address_snippet: '3 Queen Street, London, W1A 1AA',
      address: { address_line_1: '3 Queen Street', locality: 'London', postal_code: 'W1A 1AA' },
      kind: 'searchresults#company',
    },
  ],
  total_results: 3,
  items_per_page: 20,
  start_index: 0,
};

describe('searchCompany', () => {
  let client: ChApiClient;
  let cache: CacheStore;
  let dbPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ch-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    cache = new CacheStore(dbPath);
    client = new ChApiClient({
      apiKey: 'test',
      cache,
      rateLimiter: new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 }),
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

  it('returns all results with no filters', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, { query: 'acme' });
    expect(result.companies).toHaveLength(3);
    expect(result.total_results).toBe(3);
    expect(result.attribution).toContain('Open Government Licence');
  });

  it('filters by status', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, { query: 'acme', status: 'active' });
    expect(result.companies).toHaveLength(2);
    expect(result.companies.every(c => c.company_status === 'active')).toBe(true);
  });

  it('filters by region', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, { query: 'acme', region: 'Edinburgh' });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].company_number).toBe('87654321');
  });

  it('filters by incorporation date range', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, {
      query: 'acme',
      incorporated_after: '2020-01-01',
      incorporated_before: '2021-12-31',
    });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].company_number).toBe('12345678');
  });

  it('respects limit', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, { query: 'acme', limit: 1 });
    expect(result.companies).toHaveLength(1);
  });

  it('returns company details in expected format', async () => {
    globalThis.fetch = mockFetch(200, SEARCH_FIXTURE);
    const result = await searchCompany(client, { query: 'acme', limit: 1 });
    const company = result.companies[0];
    expect(company).toHaveProperty('company_name');
    expect(company).toHaveProperty('company_number');
    expect(company).toHaveProperty('company_status');
    expect(company).toHaveProperty('company_type');
    expect(company).toHaveProperty('date_of_creation');
    expect(company).toHaveProperty('registered_address');
  });
});
