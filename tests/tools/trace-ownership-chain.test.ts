import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { traceOwnershipChain } from '../../src/tools/trace-ownership-chain.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function setup() {
  const dbPath = path.join(os.tmpdir(), `ch-own-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const PROFILE_A = {
  can_file: true, company_name: 'COMPANY A LTD', company_number: '11111111',
  company_status: 'active', links: { self: '/company/11111111' }, type: 'ltd',
};

const PSCS_INDIVIDUAL = {
  active_count: 1, ceased_count: 0,
  items: [{
    name: 'Mr John Smith',
    natures_of_control: ['ownership-of-shares-75-to-100-percent'],
    notified_on: '2020-01-01',
    kind: 'individual-person-with-significant-control',
  }],
  items_per_page: 25, start_index: 0, total_results: 1,
};

const PSCS_CORPORATE = {
  active_count: 1, ceased_count: 0,
  items: [{
    name: 'HOLDING CO LTD',
    natures_of_control: ['ownership-of-shares-50-to-75-percent'],
    notified_on: '2020-01-01',
    kind: 'corporate-entity-person-with-significant-control',
    identification: {
      registration_number: '22222222',
      legal_authority: 'Companies Act 2006',
      legal_form: 'Limited',
      place_registered: 'England And Wales',
    },
  }],
  items_per_page: 25, start_index: 0, total_results: 1,
};

const PROFILE_HOLDING = {
  can_file: true, company_name: 'HOLDING CO LTD', company_number: '22222222',
  company_status: 'active', links: { self: '/company/22222222' }, type: 'ltd',
};

describe('traceOwnershipChain', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('traces a simple individual owner', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/persons-with-significant-control')) {
        body = PSCS_INDIVIDUAL;
      } else if (url.includes('/company/11111111')) {
        body = PROFILE_A;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await traceOwnershipChain(client, { company_number: '11111111' });

      expect(result.company).toBe('COMPANY A LTD');
      expect(result.chain).toHaveLength(1);
      expect(result.chain[0].entities).toHaveLength(1);
      expect(result.chain[0].entities[0].type).toBe('person');
      expect(result.chain[0].entities[0].ownership_percentage).toBe('75-100%');
      expect(result.ultimate_beneficial_owners).toHaveLength(1);
      expect(result.ultimate_beneficial_owners[0].name).toBe('Mr John Smith');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('traces through a corporate PSC to its individual owner', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};

      if (url.includes('/company/22222222/persons-with-significant-control')) {
        body = PSCS_INDIVIDUAL; // Holding co owned by an individual
      } else if (url.includes('/company/11111111/persons-with-significant-control')) {
        body = PSCS_CORPORATE; // Company A owned by Holding Co
      } else if (url.includes('/company/22222222')) {
        body = PROFILE_HOLDING;
      } else if (url.includes('/company/11111111')) {
        body = PROFILE_A;
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await traceOwnershipChain(client, { company_number: '11111111' });

      expect(result.chain).toHaveLength(2);
      expect(result.ultimate_beneficial_owners).toHaveLength(1);
      expect(result.ultimate_beneficial_owners[0].name).toBe('Mr John Smith');
      expect(result.ultimate_beneficial_owners[0].trail).toContain('HOLDING CO LTD');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('warns on foreign corporate PSC', async () => {
    const { client, cache, dbPath } = setup();

    const foreignPscs = {
      active_count: 1, ceased_count: 0,
      items: [{
        name: 'CAYMAN HOLDINGS INC',
        natures_of_control: ['ownership-of-shares-75-to-100-percent'],
        notified_on: '2020-01-01',
        kind: 'corporate-entity-person-with-significant-control',
        identification: {
          registration_number: 'CI-12345',
          place_registered: 'Cayman Islands',
        },
      }],
      items_per_page: 25, start_index: 0, total_results: 1,
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/persons-with-significant-control')) {
        body = foreignPscs;
      } else if (url.includes('/company/11111111')) {
        body = PROFILE_A;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await traceOwnershipChain(client, { company_number: '11111111' });

      expect(result.warnings.some(w => w.includes('non-UK entity'))).toBe(true);
      expect(result.ultimate_beneficial_owners[0].type).toBe('foreign_company');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('extracts non-percentage control types', async () => {
    const { client, cache, dbPath } = setup();

    const significantInfluencePscs = {
      active_count: 1, ceased_count: 0,
      items: [{
        name: 'Ms Jane Doe',
        natures_of_control: ['right-to-appoint-and-remove-directors'],
        notified_on: '2021-03-01',
        kind: 'individual-person-with-significant-control',
      }],
      items_per_page: 25, start_index: 0, total_results: 1,
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/persons-with-significant-control')) {
        body = significantInfluencePscs;
      } else {
        body = PROFILE_A;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await traceOwnershipChain(client, { company_number: '11111111' });
      expect(result.chain[0].entities[0].ownership_percentage).toBe('board appointment rights');
      expect(result.ultimate_beneficial_owners[0].name).toBe('Ms Jane Doe');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('respects max_depth', async () => {
    const { client, cache, dbPath } = setup();

    // Each level points to a different company number so we don't hit circular detection
    let nextCompany = 30000000;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/persons-with-significant-control')) {
        const cn = String(++nextCompany);
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            active_count: 1, ceased_count: 0,
            items: [{
              name: `LEVEL ${cn} LTD`,
              natures_of_control: ['ownership-of-shares-50-to-75-percent'],
              notified_on: '2020-01-01',
              kind: 'corporate-entity-person-with-significant-control',
              identification: { registration_number: cn },
            }],
            items_per_page: 25, start_index: 0, total_results: 1,
          }),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          can_file: true, company_name: 'DEEP CO LTD', company_number: '11111111',
          company_status: 'active', links: { self: '/company/11111111' }, type: 'ltd',
        }),
      });
    });

    try {
      const result = await traceOwnershipChain(client, { company_number: '11111111', max_depth: 2 });
      expect(result.warnings.some(w => w.includes('Max depth'))).toBe(true);
    } finally {
      cleanup(cache, dbPath);
    }
  });
});
