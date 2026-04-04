import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import type { CompanyProfile, Officer, OfficerList, Psc, ChargeItem, ChargeList, FilingItem } from '../api/types.js';
import { assessRisk, type RiskSummary } from '../enrichment/risk-scoring.js';
import { classifySector, classifySectors } from '../enrichment/sector-classify.js';
import { CompanyNotFoundError } from '../shared/errors.js';
import { normalizeCompanyNumber } from '../shared/company-number.js';
import { createLogger, LogLevel } from '../shared/logger.js';

const logger = createLogger('due-diligence', LogLevel.INFO);

export const DeepDueDiligenceInputSchema = {
  company_number: z.string().describe('UK company number, e.g. "00445790", "SC123456", or "NI012345". Short numbers are auto-padded to 8 digits.'),
};

export interface DueDiligenceResult {
  summary: string;
  risk: RiskSummary;
  company: Record<string, unknown>;
  officers: Record<string, unknown>;
  pscs?: Array<Record<string, unknown>>;
  charges?: Record<string, unknown>;
  insolvency_cases?: Array<Record<string, unknown>>;
  recent_filings?: Array<Record<string, unknown>>;
  data_quality?: { stale_sources: string[] };
  attribution: string;
}

export async function deepDueDiligence(
  client: ChApiClient,
  input: { company_number: string },
): Promise<DueDiligenceResult> {
  const cn = normalizeCompanyNumber(input.company_number);
  const staleSources: string[] = [];

  // Fetch all data sources in parallel
  const [profileResult, officersResult, pscsResult, filingsResult, chargesResult, insolvencyResult] =
    await Promise.allSettled([
      client.getCompanyProfile(cn),
      client.getOfficers(cn),
      client.getPscs(cn),
      client.getFilingHistory(cn, 0, 50),
      client.getCharges(cn),
      client.getInsolvency(cn),
    ]);

  // Profile is required — everything else degrades gracefully
  if (profileResult.status === 'rejected') {
    throw profileResult.reason;
  }

  const profile = profileResult.value;
  if (profile.stale) staleSources.push('company_profile');

  // Extract optional results with graceful degradation
  const officers = extractSettled(officersResult, 'officers', staleSources);
  const pscs = extractSettled(pscsResult, 'pscs', staleSources);
  const filings = extractSettled(filingsResult, 'filing_history', staleSources);
  const charges = extractSettled(chargesResult, 'charges', staleSources);
  const insolvency = extractSettled(insolvencyResult, 'insolvency', staleSources);

  // Build risk assessment
  const riskSummary = assessRisk({
    profile: profile.data,
    officers: officers?.data,
    filings: filings?.data,
    charges: charges?.data,
    insolvency: insolvency?.data,
  });

  const p = profile.data;

  // Build officer lists — strip null fields, cap resigned at 5 most recent
  const currentOfficers = (officers?.data.items ?? [])
    .filter(o => !o.resigned_on)
    .map(o => stripNulls({
      name: o.name,
      role: o.officer_role,
      appointed_on: o.appointed_on,
      nationality: o.nationality,
      occupation: o.occupation,
      officer_id: extractOfficerId(o.links),
    }));

  const allResigned = (officers?.data.items ?? []).filter(o => o.resigned_on);
  const recentResigned = allResigned
    .sort((a, b) => (b.resigned_on ?? '').localeCompare(a.resigned_on ?? ''))
    .slice(0, 5)
    .map(o => stripNulls({
      name: o.name,
      role: o.officer_role,
      appointed_on: o.appointed_on,
      resigned_on: o.resigned_on,
    }));

  // Build PSC list — only active, strip nulls
  const activePscs = (pscs?.data.items ?? [])
    .filter(psc => !psc.ceased && !psc.ceased_on)
    .map(psc => stripNulls({
      name: psc.name,
      kind: psc.kind,
      natures_of_control: psc.natures_of_control,
      notified_on: psc.notified_on,
      is_corporate: psc.kind?.includes('corporate') || undefined,
      registration_number: psc.identification?.registration_number,
    }));

  // Build charges — only include outstanding charges in detail, summarise satisfied
  const chargeItems = charges?.data.items ?? [];
  const outstandingCharges = chargeItems.filter(c => c.status === 'outstanding');
  const satisfiedCount = chargeItems.filter(c => c.status !== 'outstanding').length;

  const chargesOutput = outstandingCharges.map(c => stripNulls({
    status: c.status,
    created_on: c.created_on,
    persons_entitled: c.persons_entitled?.map(pe => pe.name),
    description: Array.isArray(c.particulars) ? c.particulars[0]?.description : c.particulars?.description,
  }));

  // Insolvency cases
  const insolvencyCases = (insolvency?.data.cases ?? []).map(ic => ({
    type: ic.type,
    dates: ic.dates.map(d => ({ date: d.date, type: d.type })),
    practitioners: ic.practitioners.map(pr => pr.name),
  }));

  // Recent filings — compact
  const recentFilings = (filings?.data.items ?? []).slice(0, 10).map(f => ({
    category: f.category,
    date: f.date,
    description: f.description,
    type: f.type,
  }));

  // Assemble result — insights first, details second
  // Only include sections that have data
  const result: Record<string, unknown> = {
    summary: buildSummary(p, riskSummary, officers?.data, charges?.data),
    risk: riskSummary,
    company: stripNulls({
      name: p.company_name,
      number: p.company_number,
      status: p.company_status ?? 'unknown',
      type: p.type,
      sector: classifySector(p.sic_codes),
      sic_codes: p.sic_codes,
      date_of_creation: p.date_of_creation,
      date_of_cessation: p.date_of_cessation,
      age_years: p.date_of_creation ? calculateAgeYears(p.date_of_creation) : undefined,
      registered_address: formatAddress(p.registered_office_address),
      jurisdiction: p.jurisdiction,
    }),
    officers: {
      current: currentOfficers,
      ...(allResigned.length > 0 ? {
        recent_resigned: recentResigned,
        total_resigned: allResigned.length,
      } : {}),
    },
  };

  if (activePscs.length > 0) result.pscs = activePscs;
  if (chargesOutput.length > 0 || satisfiedCount > 0) {
    result.charges = {
      outstanding: chargesOutput,
      satisfied_count: satisfiedCount,
      total: chargeItems.length,
    };
  }
  if (insolvencyCases.length > 0) result.insolvency_cases = insolvencyCases;
  if (recentFilings.length > 0) result.recent_filings = recentFilings;
  if (staleSources.length > 0) result.data_quality = { stale_sources: staleSources };
  result.attribution = 'Contains public sector information licensed under the Open Government Licence v3.0';

  return result as unknown as DueDiligenceResult;
}

function buildSummary(
  profile: CompanyProfile,
  risk: RiskSummary,
  officers?: OfficerList,
  charges?: ChargeList,
): string {
  const parts: string[] = [];
  const status = profile.company_status ?? 'unknown';
  const sector = classifySector(profile.sic_codes);

  // Status + age + sector
  if (profile.date_of_creation) {
    const age = calculateAgeYears(profile.date_of_creation);
    const sectorStr = sector !== 'Uncategorised' ? ` ${sector.toLowerCase()}` : '';
    parts.push(`${status} ${age < 1 ? 'newly formed' : age + '-year-old'}${sectorStr} company`);
  } else {
    parts.push(`${status} company`);
  }

  // Dissolved context
  if (status === 'dissolved' && profile.date_of_cessation) {
    parts.push(`dissolved ${profile.date_of_cessation}`);
  }

  // Risk
  parts.push(`${risk.overall} risk`);

  // Officers
  const activeCount = officers?.active_count ?? 0;
  if (activeCount > 0) {
    parts.push(`${activeCount} active director${activeCount !== 1 ? 's' : ''}`);
  } else if (officers) {
    parts.push('no active directors');
  }

  // Charges
  const chargeCount = charges?.items?.length ?? 0;
  if (chargeCount > 0) {
    const outstanding = charges?.items?.filter(c => c.status === 'outstanding').length ?? 0;
    parts.push(`${chargeCount} charge${chargeCount !== 1 ? 's' : ''}${outstanding > 0 ? ` (${outstanding} outstanding)` : ''}`);
  } else {
    parts.push('no charges');
  }

  // Critical flags from risk assessment
  for (const flag of risk.flags) {
    if (flag.severity === 'critical') {
      parts.push(flag.flag.toUpperCase());
    }
  }

  return parts.join(', ') + '.';
}

function extractSettled<T>(
  result: PromiseSettledResult<{ data: T; stale: boolean; source: string }>,
  sourceName: string,
  staleSources: string[],
): { data: T; stale: boolean } | null {
  if (result.status === 'rejected') {
    // 404 is expected for companies without charges/insolvency
    if (result.reason instanceof CompanyNotFoundError) {
      return null;
    }
    logger.warn(`Failed to fetch ${sourceName}`, {
      error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
    });
    return null;
  }
  if (result.value.stale) {
    staleSources.push(sourceName);
  }
  return { data: result.value.data, stale: result.value.stale };
}

function extractOfficerId(links: { officer?: { appointments?: string }; self?: string }): string | null {
  const appointmentsPath = links.officer?.appointments;
  if (!appointmentsPath) return null;
  // Path format: /officers/{officer_id}/appointments
  const match = appointmentsPath.match(/\/officers\/([^/]+)/);
  return match?.[1] ?? null;
}

function calculateAgeYears(dateOfCreation: string): number {
  const created = new Date(dateOfCreation).getTime();
  if (Number.isNaN(created)) return 0;
  const now = Date.now();
  return Math.round(((now - created) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
}

function formatAddress(address: Record<string, string | undefined> | undefined): string {
  if (!address) return 'No address available';
  const parts = [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ].filter(Boolean);
  return parts.join(', ') || 'No address available';
}

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
