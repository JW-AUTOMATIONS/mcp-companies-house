import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkDisqualifications } from '../../src/tools/check-disqualifications.js';
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

const PROFILE_FIXTURE = {
  company_name: 'DODGY LTD',
  company_number: '12345678',
  company_status: 'active',
  type: 'ltd',
  can_file: true,
  links: { self: '/company/12345678' },
};

const OFFICERS_FIXTURE = {
  active_count: 2,
  resigned_count: 0,
  items: [
    {
      name: 'John SMITH',
      officer_role: 'director',
      links: { officer: { appointments: '/officers/abc123/appointments' }, self: '/officers/abc123' },
    },
    {
      name: 'Jane DOE',
      officer_role: 'secretary',
      links: { officer: { appointments: '/officers/def456/appointments' }, self: '/officers/def456' },
    },
  ],
  items_per_page: 35,
  start_index: 0,
  total_results: 2,
};

const DISQUALIFIED_SEARCH_MATCH = {
  items: [
    {
      title: 'John SMITH',
      description: 'Born on 1 January 1980 - Disqualified',
      links: { self: '/disqualified-officers/natural/xyz789' },
    },
  ],
  items_per_page: 20,
  start_index: 0,
  total_results: 1,
};

const DISQUALIFIED_SEARCH_EMPTY = {
  items: [],
  items_per_page: 20,
  start_index: 0,
  total_results: 0,
};

const DISQUALIFIED_DETAIL = {
  forename: 'John',
  surname: 'SMITH',
  date_of_birth: '1980-01-01',
  disqualifications: [
    {
      disqualification_type: 'undertaking',
      disqualified_from: '2024-01-01',
      disqualified_until: '2030-12-31',
      case_identifier: 'INV123',
      company_names: ['SCAM CO LTD', 'FRAUD INC'],
      reason: {
        act: 'company-directors-disqualification-act-1986',
        section: '7',
        description_identifier: 'order-or-undertaking-and-reporting-provisions',
      },
    },
  ],
};

const DISQUALIFIED_DETAIL_EXPIRED = {
  forename: 'John',
  surname: 'SMITH',
  disqualifications: [
    {
      disqualification_type: 'order',
      disqualified_from: '2015-01-01',
      disqualified_until: '2020-12-31',
      company_names: ['OLD CO LTD'],
      reason: { description_identifier: 'some-reason' },
    },
  ],
};

let dbDir: string;
let dbPath: string;
let cache: CacheStore;
let rateLimiter: TokenBucketRateLimiter;

beforeEach(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-disq-test-'));
  dbPath = path.join(dbDir, 'test.db');
  cache = new CacheStore(dbPath);
  rateLimiter = new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 });
});

afterEach(() => {
  cache.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function createClient(fetchImpl: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  return new ChApiClient({ apiKey: 'test-key', cache, rateLimiter });
}

describe('checkDisqualifications', () => {
  it('returns clean result when no officers are disqualified', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(OFFICERS_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.officers_checked).toBe(2);
    expect(result.company_name).toBe('DODGY LTD');
  });

  it('detects a disqualified director with active order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(OFFICERS_FIXTURE) })
      // John SMITH search hits
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_MATCH) })
      // John SMITH detail
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_DETAIL) })
      // Jane DOE search — no match
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    expect(result.clean).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].officer_name).toBe('John SMITH');
    expect(result.matches[0].disqualified_until).toBe('2030-12-31');
    expect(result.matches[0].related_companies).toContain('SCAM CO LTD');
  });

  it('ignores expired disqualifications', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(OFFICERS_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_MATCH) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_DETAIL_EXPIRED) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it('only checks active (non-resigned) officers', async () => {
    const officersWithResigned = {
      ...OFFICERS_FIXTURE,
      items: [
        ...OFFICERS_FIXTURE.items,
        {
          name: 'Bob RESIGNED',
          officer_role: 'director',
          resigned_on: '2023-01-01',
          links: { officer: { appointments: '/officers/ghi/appointments' }, self: '/officers/ghi' },
        },
      ],
      total_results: 3,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(officersWithResigned) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    expect(result.officers_checked).toBe(2); // Bob excluded
  });

  it('handles disqualified search API errors gracefully', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(OFFICERS_FIXTURE) })
      // Search fails for John
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
      // Search succeeds for Jane (no match)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_EMPTY) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    // Should not crash — graceful degradation
    expect(result.officers_checked).toBe(2);
    expect(result.clean).toBe(true);
  });

  it('handles name matching with different formats', async () => {
    const officersAlt = {
      ...OFFICERS_FIXTURE,
      active_count: 1,
      items: [
        {
          name: 'SMITH, John',
          officer_role: 'director',
          links: { officer: { appointments: '/officers/abc/appointments' }, self: '/officers/abc' },
        },
      ],
      total_results: 1,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(PROFILE_FIXTURE) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(officersAlt) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_SEARCH_MATCH) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(DISQUALIFIED_DETAIL) });

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await checkDisqualifications(client, { company_number: '12345678' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].officer_name).toBe('SMITH, John');
  });
});
