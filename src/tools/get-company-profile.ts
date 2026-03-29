import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import { normalizeCompanyNumber } from '../shared/company-number.js';
import { classifySector, classifySectors } from '../enrichment/sector-classify.js';

export const GetCompanyProfileInputSchema = {
  company_number: z.string().describe('UK company number, e.g. "12345678" or "SC123456". Auto-pads short numbers.'),
};

export interface CompanyProfileResult {
  company_name: string;
  company_number: string;
  status: string;
  type: string;
  date_of_creation: string | null;
  date_of_cessation: string | null;
  age_years: number | null;
  registered_address: string;
  jurisdiction: string | null;
  sector: string;
  sectors: string[];
  sic_codes: string[];
  has_charges: boolean;
  has_insolvency_history: boolean;
  can_file: boolean;
  accounts: {
    next_due: string | null;
    overdue: boolean;
    last_made_up_to: string | null;
  };
  confirmation_statement: {
    next_due: string | null;
    overdue: boolean;
  };
  previous_names: string[];
  attribution: string;
}

export async function getCompanyProfile(
  client: ChApiClient,
  input: { company_number: string },
): Promise<CompanyProfileResult> {
  const cn = normalizeCompanyNumber(input.company_number);
  const { data: p } = await client.getCompanyProfile(cn);

  return {
    company_name: p.company_name,
    company_number: p.company_number,
    status: p.company_status ?? 'unknown',
    type: p.type,
    date_of_creation: p.date_of_creation ?? null,
    date_of_cessation: p.date_of_cessation ?? null,
    age_years: p.date_of_creation ? calculateAgeYears(p.date_of_creation) : null,
    registered_address: formatAddress(p.registered_office_address),
    jurisdiction: p.jurisdiction ?? null,
    sector: classifySector(p.sic_codes),
    sectors: classifySectors(p.sic_codes),
    sic_codes: p.sic_codes ?? [],
    has_charges: p.has_charges ?? false,
    has_insolvency_history: p.has_insolvency_history ?? false,
    can_file: p.can_file,
    accounts: {
      next_due: p.accounts?.next_accounts?.due_on ?? null,
      overdue: p.accounts?.next_accounts?.overdue ?? false,
      last_made_up_to: p.accounts?.last_accounts?.made_up_to ?? null,
    },
    confirmation_statement: {
      next_due: p.confirmation_statement?.next_due ?? null,
      overdue: p.confirmation_statement?.overdue ?? false,
    },
    previous_names: p.previous_company_names?.map(n => `${n.name} (until ${n.ceased_on})`) ?? [],
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

function calculateAgeYears(dateOfCreation: string): number {
  const created = new Date(dateOfCreation).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.round(((Date.now() - created) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
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
