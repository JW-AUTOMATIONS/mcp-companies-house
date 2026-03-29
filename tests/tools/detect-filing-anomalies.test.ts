import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectFilingAnomalies } from '../../src/tools/detect-filing-anomalies.js';
import { ChApiClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/sqlite.js';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function setup() {
  const dbPath = path.join(os.tmpdir(), `ch-anomaly-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const HEALTHY_PROFILE = {
  can_file: true,
  company_name: 'HEALTHY LTD',
  company_number: '12345678',
  company_status: 'active',
  date_of_creation: '2015-01-01',
  links: { self: '/company/12345678' },
  type: 'ltd',
  accounts: {
    next_accounts: { due_on: '2026-09-30', overdue: false },
  },
  confirmation_statement: {
    next_due: '2027-01-15',
    next_made_up_to: '2027-01-01',
    overdue: false,
  },
};

function recentDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().split('T')[0];
}

describe('detectFilingAnomalies', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns healthy for a well-filed company', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      let body: unknown = {};
      if (url.includes('/filing-history')) {
        body = {
          items: [
            { category: 'accounts', date: recentDate(3), description: 'full accounts', transaction_id: 't1', type: 'AA' },
            { category: 'confirmation-statement', date: recentDate(6), description: 'confirmation', transaction_id: 't2', type: 'CS01' },
          ],
          items_per_page: 25, start_index: 0, total_count: 2,
        };
      } else {
        body = HEALTHY_PROFILE;
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      expect(result.filing_health).toBe('healthy');
      expect(result.anomalies.filter(a => a.severity === 'critical')).toHaveLength(0);
      expect(result.next_due.length).toBeGreaterThan(0);
      expect(result.filing_summary.total_in_period).toBe(2);
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('detects overdue accounts', async () => {
    const { client, cache, dbPath } = setup();

    const overdueProfile = {
      ...HEALTHY_PROFILE,
      accounts: { next_accounts: { due_on: '2025-01-01', overdue: true } },
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const body = url.includes('/filing-history')
        ? { items: [], items_per_page: 25, start_index: 0, total_count: 0 }
        : overdueProfile;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      expect(result.filing_health).toBe('problematic');
      const overdue = result.anomalies.find(a => a.type === 'overdue_accounts');
      expect(overdue).toBeDefined();
      expect(overdue!.severity).toBe('critical');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('detects frequent address changes', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/filing-history')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            items: [
              { category: 'address', date: recentDate(2), description: 'change', transaction_id: 't1', type: 'AD01' },
              { category: 'address', date: recentDate(6), description: 'change', transaction_id: 't2', type: 'AD01' },
              { category: 'address', date: recentDate(10), description: 'change', transaction_id: 't3', type: 'AD01' },
            ],
            items_per_page: 25, start_index: 0, total_count: 3,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(HEALTHY_PROFILE) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      const anomaly = result.anomalies.find(a => a.type === 'frequent_address_change');
      expect(anomaly).toBeDefined();
      expect(anomaly!.severity).toBe('warning');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('detects rapid director turnover', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/filing-history')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            items: [
              { category: 'officers', date: recentDate(1), description: 'termination of director', transaction_id: 't1', type: 'TM01' },
              { category: 'officers', date: recentDate(3), description: 'termination of director', transaction_id: 't2', type: 'TM01' },
              { category: 'officers', date: recentDate(8), description: 'termination of director', transaction_id: 't3', type: 'TM01' },
            ],
            items_per_page: 25, start_index: 0, total_count: 3,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(HEALTHY_PROFILE) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      const anomaly = result.anomalies.find(a => a.type === 'rapid_director_turnover');
      expect(anomaly).toBeDefined();
      expect(anomaly!.severity).toBe('warning');
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('detects no recent filings for active company', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/filing-history')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            items: [
              // All filings are older than 24 months
              { category: 'accounts', date: '2023-01-01', description: 'full accounts', transaction_id: 't1', type: 'AA' },
            ],
            items_per_page: 25, start_index: 0, total_count: 1,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(HEALTHY_PROFILE) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      const anomaly = result.anomalies.find(a => a.type === 'no_recent_filings');
      expect(anomaly).toBeDefined();
    } finally {
      cleanup(cache, dbPath);
    }
  });

  it('includes filing summary by category', async () => {
    const { client, cache, dbPath } = setup();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/filing-history')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            items: [
              { category: 'accounts', date: recentDate(3), description: 'accounts', transaction_id: 't1', type: 'AA' },
              { category: 'accounts', date: recentDate(15), description: 'accounts', transaction_id: 't2', type: 'AA' },
              { category: 'officers', date: recentDate(6), description: 'appointment', transaction_id: 't3', type: 'AP01' },
            ],
            items_per_page: 25, start_index: 0, total_count: 3,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(HEALTHY_PROFILE) });
    });

    try {
      const result = await detectFilingAnomalies(client, { company_number: '12345678' });
      expect(result.filing_summary.total_in_period).toBe(3);
      expect(result.filing_summary.by_category.accounts).toBe(2);
      expect(result.filing_summary.by_category.officers).toBe(1);
    } finally {
      cleanup(cache, dbPath);
    }
  });
});
