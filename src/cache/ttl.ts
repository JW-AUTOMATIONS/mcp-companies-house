export enum CacheCategory {
  COMPANY_PROFILE = 'company_profile',
  OFFICERS = 'officers',
  PSCS = 'pscs',
  FILING_HISTORY = 'filing_history',
  CHARGES = 'charges',
  INSOLVENCY = 'insolvency',
  SEARCH = 'search',
  OFFICER_APPOINTMENTS = 'officer_appointments',
}

const DEFAULT_TTL_SECONDS: Record<CacheCategory, number> = {
  [CacheCategory.COMPANY_PROFILE]: 86_400,        // 24 hours
  [CacheCategory.OFFICERS]: 43_200,                // 12 hours
  [CacheCategory.PSCS]: 43_200,                    // 12 hours
  [CacheCategory.FILING_HISTORY]: 3_600,           // 1 hour
  [CacheCategory.CHARGES]: 86_400,                 // 24 hours
  [CacheCategory.INSOLVENCY]: 21_600,              // 6 hours
  [CacheCategory.SEARCH]: 1_800,                   // 30 minutes
  [CacheCategory.OFFICER_APPOINTMENTS]: 43_200,    // 12 hours
};

const PRO_TTL_SECONDS: Record<CacheCategory, number> = {
  [CacheCategory.COMPANY_PROFILE]: 43_200,         // 12 hours
  [CacheCategory.OFFICERS]: 21_600,                // 6 hours
  [CacheCategory.PSCS]: 21_600,                    // 6 hours
  [CacheCategory.FILING_HISTORY]: 1_800,           // 30 minutes
  [CacheCategory.CHARGES]: 43_200,                 // 24 hours
  [CacheCategory.INSOLVENCY]: 10_800,              // 3 hours
  [CacheCategory.SEARCH]: 900,                     // 15 minutes
  [CacheCategory.OFFICER_APPOINTMENTS]: 21_600,    // 6 hours
};

export function getTtlSeconds(category: CacheCategory, isPro: boolean): number {
  return isPro ? PRO_TTL_SECONDS[category] : DEFAULT_TTL_SECONDS[category];
}
