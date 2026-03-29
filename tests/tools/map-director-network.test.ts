import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mapDirectorNetwork } from '../../src/tools/map-director-network.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function setup() {
  const dbPath = path.join(os.tmpdir(), `ch-dir-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const APPOINTMENTS = {
  name: 'John SMITH',
  date_of_birth: { month: 6, year: 1980 },
  items: [
    {
      name: 'SMITH, John',
      officer_role: 'director',
      appointed_on: '2018-01-01',
      appointed_to: { company_name: 'ALPHA LTD', company_number: '11111111', company_status: 'active' },
    },
    {
      name: 'SMITH, John',
      officer_role: 'director',
      appointed_on: '2020-06-01',
      appointed_to: { company_name: 'BETA LTD', company_number: '22222222', company_status: 'active' },
    },
    {
      name: 'SMITH, John',
      officer_role: 'director',
      appointed_on: '2015-03-01',
      resigned_on: '2019-12-31',
      appointed_to: { company_name: 'GAMMA LTD', company_number: '33333333', company_status: 'dissolved' },
    },
  ],
  items_per_page: 50,
  start_index: 0,
  total_results: 3,
};

const OFFICERS_ALPHA = {
  active_count: 2,
  items: [
    { name: 'SMITH, John', officer_role: 'director', links: { self: '/o/1' } },
    { name: 'JONES, Sarah', officer_role: 'director', links: { self: '/o/2' } },
  ],
  items_per_page: 35, resigned_count: 0, start_index: 0, total_results: 2,
};

const OFFICERS_BETA = {
  active_count: 2,
  items: [
    { name: 'SMITH, John', officer_role: 'director', links: { self: '/o/1' } },
    { name: 'JONES, Sarah', officer_role: 'secretary', links: { self: '/o/3' } },
  ],
  items_per_page: 35, resigned_count: 0, start_index: 0, total_results: 2,
};

describe('mapDirectorNetwork', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('maps a director network with co-directors', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};

      if (url.includes('/officers/abc123/appointments')) {
        body = APPOINTMENTS;
      } else if (url.includes('/company/11111111/officers')) {
        body = OFFICERS_ALPHA;
      } else if (url.includes('/company/22222222/officers')) {
        body = OFFICERS_BETA;
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await mapDirectorNetwork(client, { officer_id: 'abc123' });

      expect(result.person.name).toBe('John SMITH');
      expect(result.person.date_of_birth?.year).toBe(1980);

      // Active appointments only by default
      expect(result.appointments).toHaveLength(2);
      expect(result.appointments.every(a => a.resigned_on === null)).toBe(true);

      // Sarah Jones is a co-director at both Alpha and Beta
      expect(result.co_directors.length).toBeGreaterThan(0);
      const jones = result.co_directors.find(cd => cd.name === 'JONES, Sarah');
      expect(jones).toBeDefined();
      expect(jones!.shared_count).toBe(2);

      expect(result.statistics.active_appointments).toBe(2);
      expect(result.statistics.dissolved_companies).toBe(1);
      expect(result.statistics.total_appointments).toBe(3);
      expect(result.statistics.average_tenure_months).toBeGreaterThan(0);

      expect(result.attribution).toContain('Open Government Licence');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('includes resigned appointments when requested', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/appointments')) {
        body = APPOINTMENTS;
      } else if (url.includes('/officers')) {
        body = OFFICERS_ALPHA;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await mapDirectorNetwork(client, { officer_id: 'abc123', include_resigned: true });
      expect(result.appointments).toHaveLength(3);
      expect(result.appointments.some(a => a.resigned_on !== null)).toBe(true);
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('flags serial directors', async () => {
    const { client, cache, dbPath } = setup();

    const manyAppointments = {
      ...APPOINTMENTS,
      items: Array.from({ length: 12 }, (_, i) => ({
        name: 'SMITH, John',
        officer_role: 'director',
        appointed_on: '2020-01-01',
        appointed_to: {
          company_name: `CO ${i} LTD`,
          company_number: String(10000000 + i),
          company_status: 'active',
        },
      })),
      total_results: 12,
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/appointments')) {
        body = manyAppointments;
      } else if (url.includes('/officers')) {
        body = { active_count: 1, items: [], items_per_page: 35, resigned_count: 0, start_index: 0, total_results: 0 };
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await mapDirectorNetwork(client, { officer_id: 'abc123' });
      expect(result.flags.some(f => f.includes('serial director'))).toBe(true);
    } finally {
      cleanup(cache, dbPath);
    }
  });
});
