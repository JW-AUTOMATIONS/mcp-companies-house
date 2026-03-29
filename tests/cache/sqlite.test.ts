import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheStore } from '../../src/cache/sqlite.js';
import { CacheCategory } from '../../src/cache/ttl.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('CacheStore', () => {
  let cache: CacheStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ch-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    cache = new CacheStore(dbPath);
  });

  afterEach(() => {
    cache.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
    }
  });

  it('returns null for a cache miss', () => {
    const result = cache.get('nonexistent', CacheCategory.COMPANY_PROFILE, false);
    expect(result).toBeNull();
  });

  it('stores and retrieves data', () => {
    const data = { company_name: 'TEST LTD', company_number: '12345678' };
    cache.set('12345678', CacheCategory.COMPANY_PROFILE, data);

    const result = cache.get<typeof data>('12345678', CacheCategory.COMPANY_PROFILE, false);
    expect(result).not.toBeNull();
    expect(result!.data.company_name).toBe('TEST LTD');
    expect(result!.stale).toBe(false);
  });

  it('upserts on duplicate key+category', () => {
    cache.set('12345678', CacheCategory.COMPANY_PROFILE, { name: 'OLD' });
    cache.set('12345678', CacheCategory.COMPANY_PROFILE, { name: 'NEW' });

    const result = cache.get<{ name: string }>('12345678', CacheCategory.COMPANY_PROFILE, false);
    expect(result!.data.name).toBe('NEW');
  });

  it('keeps different categories separate for same key', () => {
    cache.set('12345678', CacheCategory.COMPANY_PROFILE, { type: 'profile' });
    cache.set('12345678', CacheCategory.OFFICERS, { type: 'officers' });

    const profile = cache.get<{ type: string }>('12345678', CacheCategory.COMPANY_PROFILE, false);
    const officers = cache.get<{ type: string }>('12345678', CacheCategory.OFFICERS, false);

    expect(profile!.data.type).toBe('profile');
    expect(officers!.data.type).toBe('officers');
  });

  it('marks data as stale when TTL expired', () => {
    cache.set('12345678', CacheCategory.SEARCH, { q: 'test' });

    // Manually backdate the fetched_at to simulate expiry (search TTL = 1800s)
    const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare('UPDATE cache SET fetched_at = fetched_at - 2000 WHERE key = ?').run('12345678');

    const result = cache.get('12345678', CacheCategory.SEARCH, false);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
  });

  it('pro tier has shorter TTL (stales sooner)', () => {
    cache.set('12345678', CacheCategory.SEARCH, { q: 'test' });

    // Backdate by 1000s — free TTL is 1800s (not stale), pro TTL is 900s (stale)
    const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare('UPDATE cache SET fetched_at = fetched_at - 1000 WHERE key = ?').run('12345678');

    const freeResult = cache.get('12345678', CacheCategory.SEARCH, false);
    const proResult = cache.get('12345678', CacheCategory.SEARCH, true);

    expect(freeResult!.stale).toBe(false);
    expect(proResult!.stale).toBe(true);
  });

  it('deletes a specific cache entry', () => {
    cache.set('12345678', CacheCategory.COMPANY_PROFILE, { name: 'TEST' });
    cache.delete('12345678', CacheCategory.COMPANY_PROFILE);

    const result = cache.get('12345678', CacheCategory.COMPANY_PROFILE, false);
    expect(result).toBeNull();
  });

  it('prunes old entries by category', () => {
    cache.set('A', CacheCategory.SEARCH, { q: 'a' });
    cache.set('B', CacheCategory.SEARCH, { q: 'b' });
    cache.set('C', CacheCategory.COMPANY_PROFILE, { q: 'c' });

    // Backdate search entries
    const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare("UPDATE cache SET fetched_at = fetched_at - 5000 WHERE category = 'search'").run();

    const pruned = cache.prune(CacheCategory.SEARCH, 3600);
    expect(pruned).toBe(2);

    // Company profile should be untouched
    const profile = cache.get('C', CacheCategory.COMPANY_PROFILE, false);
    expect(profile).not.toBeNull();
  });

  it('evicts entries with corrupt JSON', () => {
    // Insert corrupt data directly
    const db = (cache as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(
      'INSERT INTO cache (key, category, data, fetched_at) VALUES (?, ?, ?, ?)'
    ).run('corrupt', 'company_profile', '{not valid json', Math.floor(Date.now() / 1000));

    const result = cache.get('corrupt', CacheCategory.COMPANY_PROFILE, false);
    expect(result).toBeNull();

    // Verify it was evicted
    const row = db.prepare('SELECT * FROM cache WHERE key = ?').get('corrupt');
    expect(row).toBeUndefined();
  });
});
