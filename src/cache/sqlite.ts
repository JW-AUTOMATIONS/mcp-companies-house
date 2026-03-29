import Database from 'better-sqlite3';
import { CacheCategory, getTtlSeconds } from './ttl.js';
import { createLogger, LogLevel } from '../shared/logger.js';

const logger = createLogger('cache', LogLevel.INFO);

export interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

export class CacheStore {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private upsertStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private pruneStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT NOT NULL,
        category TEXT NOT NULL,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (key, category)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_category_fetched
      ON cache (category, fetched_at)
    `);

    this.getStmt = this.db.prepare(
      'SELECT data, fetched_at FROM cache WHERE key = ? AND category = ?'
    );
    this.upsertStmt = this.db.prepare(
      `INSERT INTO cache (key, category, data, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key, category)
       DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
    );
    this.deleteStmt = this.db.prepare(
      'DELETE FROM cache WHERE key = ? AND category = ?'
    );
    this.pruneStmt = this.db.prepare(
      'DELETE FROM cache WHERE category = ? AND fetched_at < ?'
    );
  }

  get<T>(key: string, category: CacheCategory, isPro: boolean): CacheEntry<T> | null {
    const row = this.getStmt.get(key, category) as
      | { data: string; fetched_at: number }
      | undefined;

    if (!row) {
      return null;
    }

    const ttl = getTtlSeconds(category, isPro);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stale = row.fetched_at + ttl < nowSeconds;

    try {
      const data = JSON.parse(row.data) as T;
      return { data, fetchedAt: row.fetched_at, stale };
    } catch {
      logger.warn('Failed to parse cached data, evicting', { key, category });
      this.deleteStmt.run(key, category);
      return null;
    }
  }

  set(key: string, category: CacheCategory, data: unknown): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const json = JSON.stringify(data);
    this.upsertStmt.run(key, category, json, nowSeconds);
  }

  delete(key: string, category: CacheCategory): void {
    this.deleteStmt.run(key, category);
  }

  prune(category: CacheCategory, maxAgeSeconds: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    const result = this.pruneStmt.run(category, cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
