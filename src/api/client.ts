import { CacheStore } from '../cache/sqlite.js';
import { CacheCategory } from '../cache/ttl.js';
import { TokenBucketRateLimiter } from '../shared/rate-limiter.js';
import { createLogger, LogLevel } from '../shared/logger.js';
import {
  CompanyNotFoundError,
  RateLimitedError,
  ApiUnavailableError,
  InvalidInputError,
} from '../shared/errors.js';
import {
  CompanyProfileSchema,
  OfficerListSchema,
  PscListSchema,
  FilingHistoryListSchema,
  ChargeListSchema,
  CompanyInsolvencySchema,
  CompanySearchResultSchema,
  OfficerAppointmentListSchema,
  OfficerSearchResultSchema,
  DisqualifiedOfficerSchema,
  DisqualifiedSearchResultSchema,
} from './types.js';
import type {
  CompanyProfile,
  OfficerList,
  PscList,
  FilingHistoryList,
  ChargeList,
  CompanyInsolvency,
  CompanySearchResult,
  OfficerAppointmentList,
  OfficerSearchResult,
  DisqualifiedOfficer,
  DisqualifiedSearchResult,
} from './types.js';

const logger = createLogger('ch-api', LogLevel.INFO);

const CH_API_BASE = 'https://api.company-information.service.gov.uk';

export interface ChApiClientConfig {
  apiKey: string;
  cache: CacheStore;
  rateLimiter: TokenBucketRateLimiter;
  isPro?: boolean;
}

interface FetchResult<T> {
  data: T;
  stale: boolean;
  source: 'cache' | 'api';
}

export class ChApiClient {
  private readonly apiKey: string;
  private readonly cache: CacheStore;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly isPro: boolean;
  private readonly authHeader: string;

  constructor(config: ChApiClientConfig) {
    this.apiKey = config.apiKey;
    this.cache = config.cache;
    this.rateLimiter = config.rateLimiter;
    this.isPro = config.isPro ?? false;
    this.authHeader = 'Basic ' + Buffer.from(this.apiKey + ':').toString('base64');
  }

  async getCompanyProfile(companyNumber: string): Promise<FetchResult<CompanyProfile>> {
    this.validateCompanyNumber(companyNumber);
    return this.fetchWithCache(
      `/company/${companyNumber}`,
      companyNumber,
      CacheCategory.COMPANY_PROFILE,
      CompanyProfileSchema,
    );
  }

  async getOfficers(companyNumber: string, startIndex = 0, itemsPerPage = 100): Promise<FetchResult<OfficerList>> {
    this.validateCompanyNumber(companyNumber);
    const params = new URLSearchParams({
      start_index: String(startIndex),
      items_per_page: String(itemsPerPage),
    });
    const cacheKey = `${companyNumber}:officers:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/company/${companyNumber}/officers?${params}`,
      cacheKey,
      CacheCategory.OFFICERS,
      OfficerListSchema,
    );
  }

  async getPscs(companyNumber: string): Promise<FetchResult<PscList>> {
    this.validateCompanyNumber(companyNumber);
    return this.fetchWithCache(
      `/company/${companyNumber}/persons-with-significant-control`,
      `${companyNumber}:pscs`,
      CacheCategory.PSCS,
      PscListSchema,
    );
  }

  async getFilingHistory(companyNumber: string, startIndex = 0, itemsPerPage = 100): Promise<FetchResult<FilingHistoryList>> {
    this.validateCompanyNumber(companyNumber);
    const params = new URLSearchParams({
      start_index: String(startIndex),
      items_per_page: String(itemsPerPage),
    });
    const cacheKey = `${companyNumber}:filings:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/company/${companyNumber}/filing-history?${params}`,
      cacheKey,
      CacheCategory.FILING_HISTORY,
      FilingHistoryListSchema,
    );
  }

  async getCharges(companyNumber: string): Promise<FetchResult<ChargeList>> {
    this.validateCompanyNumber(companyNumber);
    return this.fetchWithCache(
      `/company/${companyNumber}/charges`,
      `${companyNumber}:charges`,
      CacheCategory.CHARGES,
      ChargeListSchema,
    );
  }

  async getInsolvency(companyNumber: string): Promise<FetchResult<CompanyInsolvency>> {
    this.validateCompanyNumber(companyNumber);
    return this.fetchWithCache(
      `/company/${companyNumber}/insolvency`,
      `${companyNumber}:insolvency`,
      CacheCategory.INSOLVENCY,
      CompanyInsolvencySchema,
    );
  }

  async searchCompanies(query: string, startIndex = 0, itemsPerPage = 20): Promise<FetchResult<CompanySearchResult>> {
    if (!query.trim()) {
      throw new InvalidInputError('Search query must not be empty.');
    }
    const params = new URLSearchParams({
      q: query,
      start_index: String(startIndex),
      items_per_page: String(Math.min(itemsPerPage, 50)),
    });
    const cacheKey = `search:${query}:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/search/companies?${params}`,
      cacheKey,
      CacheCategory.SEARCH,
      CompanySearchResultSchema,
    );
  }

  async getOfficerAppointments(officerId: string, startIndex = 0, itemsPerPage = 50): Promise<FetchResult<OfficerAppointmentList>> {
    if (!officerId.trim()) {
      throw new InvalidInputError('Officer ID must not be empty.');
    }
    const params = new URLSearchParams({
      start_index: String(startIndex),
      items_per_page: String(itemsPerPage),
    });
    const cacheKey = `appointments:${officerId}:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/officers/${officerId}/appointments?${params}`,
      cacheKey,
      CacheCategory.OFFICER_APPOINTMENTS,
      OfficerAppointmentListSchema,
    );
  }

  async searchOfficers(query: string, startIndex = 0, itemsPerPage = 20): Promise<FetchResult<OfficerSearchResult>> {
    if (!query.trim()) {
      throw new InvalidInputError('Search query must not be empty.');
    }
    const params = new URLSearchParams({
      q: query,
      start_index: String(startIndex),
      items_per_page: String(Math.min(itemsPerPage, 50)),
    });
    const cacheKey = `officer-search:${query}:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/search/officers?${params}`,
      cacheKey,
      CacheCategory.SEARCH,
      OfficerSearchResultSchema,
    );
  }

  async searchDisqualifiedOfficers(query: string, startIndex = 0, itemsPerPage = 20): Promise<FetchResult<DisqualifiedSearchResult>> {
    if (!query.trim()) {
      throw new InvalidInputError('Search query must not be empty.');
    }
    const params = new URLSearchParams({
      q: query,
      start_index: String(startIndex),
      items_per_page: String(Math.min(itemsPerPage, 50)),
    });
    const cacheKey = `disqualified-search:${query}:${startIndex}:${itemsPerPage}`;
    return this.fetchWithCache(
      `/search/disqualified-officers?${params}`,
      cacheKey,
      CacheCategory.DISQUALIFICATIONS,
      DisqualifiedSearchResultSchema,
    );
  }

  async getDisqualifiedOfficer(officerId: string, type: 'natural' | 'corporate' = 'natural'): Promise<FetchResult<DisqualifiedOfficer>> {
    if (!officerId.trim()) {
      throw new InvalidInputError('Officer ID must not be empty.');
    }
    const cacheKey = `disqualified:${type}:${officerId}`;
    return this.fetchWithCache(
      `/disqualified-officers/${type}/${officerId}`,
      cacheKey,
      CacheCategory.DISQUALIFICATIONS,
      DisqualifiedOfficerSchema,
    );
  }

  private validateCompanyNumber(companyNumber: string): void {
    if (!/^[A-Z0-9]{2}\d{6}$|^\d{8}$/.test(companyNumber.toUpperCase())) {
      throw new InvalidInputError(
        `Invalid company number "${companyNumber}". Expected 8 digits (e.g., "12345678") or 2 letters + 6 digits (e.g., "SC123456").`
      );
    }
  }

  private async fetchWithCache<T>(
    path: string,
    cacheKey: string,
    category: CacheCategory,
    schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: unknown } },
  ): Promise<FetchResult<T>> {
    // Check cache first
    const cached = this.cache.get<T>(cacheKey, category, this.isPro);
    if (cached && !cached.stale) {
      return { data: cached.data, stale: false, source: 'cache' };
    }

    // Try to fetch fresh data
    try {
      await this.rateLimiter.waitForTokens(1);
      const response = await this.httpGet(path);

      if (response.status === 401) {
        throw new InvalidInputError(
          'Invalid or expired API key. Register at https://developer.company-information.service.gov.uk/ and set CH_API_KEY.',
        );
      }

      if (response.status === 403) {
        throw new InvalidInputError(
          'API key does not have access to this resource. Check your Companies House application permissions.',
        );
      }

      if (response.status === 404) {
        if (category === CacheCategory.COMPANY_PROFILE) {
          throw new CompanyNotFoundError(cacheKey);
        }
        // For sub-resources (charges, insolvency), 404 means no data
        // Return empty structure rather than throwing
        throw new CompanyNotFoundError(cacheKey);
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 30;
        logger.warn('Rate limited by Companies House API', { path, retryAfter: retrySeconds });
        if (cached) {
          return { data: cached.data, stale: true, source: 'cache' };
        }
        throw new RateLimitedError(retrySeconds);
      }

      if (response.status >= 500) {
        logger.warn('Companies House API error', { path, status: response.status });
        if (cached) {
          return { data: cached.data, stale: true, source: 'cache' };
        }
        throw new ApiUnavailableError();
      }

      if (!response.ok) {
        logger.error('Unexpected API response', { path, status: response.status });
        if (cached) {
          return { data: cached.data, stale: true, source: 'cache' };
        }
        throw new ApiUnavailableError();
      }

      const json = await response.json();
      const parsed = schema.safeParse(json);

      if (!parsed.success) {
        logger.error('API response failed schema validation', {
          path,
          error: parsed.error,
        });
        if (cached) {
          return { data: cached.data, stale: true, source: 'cache' };
        }
        throw new ApiUnavailableError();
      }

      // Update cache — data is guaranteed present when success is true
      const data = parsed.data as T;
      this.cache.set(cacheKey, category, data);
      return { data, stale: false, source: 'api' };

    } catch (error) {
      // Re-throw our known errors
      if (error instanceof CompanyNotFoundError ||
          error instanceof RateLimitedError ||
          error instanceof ApiUnavailableError ||
          error instanceof InvalidInputError) {
        throw error;
      }

      // Network/fetch errors — serve stale cache if available
      logger.error('Network error fetching from Companies House API', {
        path,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      if (cached) {
        return { data: cached.data, stale: true, source: 'cache' };
      }
      throw new ApiUnavailableError();
    }
  }

  async validateApiKey(): Promise<{ valid: boolean; message: string }> {
    try {
      const response = await this.httpGet('/search/companies?q=test&items_per_page=1');
      if (response.status === 401) {
        return { valid: false, message: 'Invalid or expired API key. Register at https://developer.company-information.service.gov.uk/' };
      }
      if (response.status === 403) {
        return { valid: false, message: 'API key lacks required permissions. Check your Companies House application settings.' };
      }
      return { valid: true, message: 'API key verified' };
    } catch {
      return { valid: true, message: 'Could not verify API key (network error), proceeding anyway' };
    }
  }

  private async httpGet(path: string): Promise<Response> {
    const url = `${CH_API_BASE}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
