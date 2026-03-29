import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import { classifySector } from '../enrichment/sector-classify.js';

export const SearchCompanyInputSchema = {
  query: z.string().describe('Company name or number to search for'),
  sic_codes: z.array(z.string()).optional().describe('Filter by SIC code(s), e.g. ["62020"]'),
  region: z.string().optional().describe('Filter by registered office region, e.g. "London"'),
  incorporated_after: z.string().optional().describe('ISO date — only companies formed after this date'),
  incorporated_before: z.string().optional().describe('ISO date — only companies formed before this date'),
  status: z.enum(['active', 'dissolved', 'liquidation', 'receivership', 'administration', 'open', 'closed', 'all']).optional().describe('Filter by company status. Default: all'),
  limit: z.number().min(1).max(50).optional().describe('Max results to return. Default: 10, max: 50'),
};

export interface SearchCompanyResult {
  companies: Array<{
    company_name: string;
    company_number: string;
    company_status: string;
    company_type: string;
    sector: string;
    date_of_creation: string | null;
    date_of_cessation: string | null;
    registered_address: string;
    snippet: string | null;
  }>;
  total_results: number;
  filtered_count: number;
  attribution: string;
}

export async function searchCompany(
  client: ChApiClient,
  input: z.infer<z.ZodObject<typeof SearchCompanyInputSchema>>,
): Promise<SearchCompanyResult> {
  const limit = input.limit ?? 10;
  // Fetch extra results to account for post-filtering
  const fetchSize = Math.min(limit * 3, 50);

  const { data: searchResult } = await client.searchCompanies(input.query, 0, fetchSize);

  let items = searchResult.items;

  // Post-filter: status
  if (input.status && input.status !== 'all') {
    items = items.filter(item => item.company_status === input.status);
  }

  // Post-filter: region (match against address fields)
  if (input.region) {
    const regionLower = input.region.toLowerCase();
    items = items.filter(item => {
      const addr = item.address;
      if (!addr) return false;
      const fields = [addr.region, addr.locality, addr.country, addr.address_line_1, addr.address_line_2];
      return fields.some(f => f?.toLowerCase().includes(regionLower));
    });
  }

  // Post-filter: incorporation date range
  if (input.incorporated_after) {
    const after = new Date(input.incorporated_after).getTime();
    if (!Number.isNaN(after)) {
      items = items.filter(item => {
        if (!item.date_of_creation) return false;
        const created = new Date(item.date_of_creation).getTime();
        return !Number.isNaN(created) && created >= after;
      });
    }
  }
  if (input.incorporated_before) {
    const before = new Date(input.incorporated_before).getTime();
    if (!Number.isNaN(before)) {
      items = items.filter(item => {
        if (!item.date_of_creation) return false;
        const created = new Date(item.date_of_creation).getTime();
        return !Number.isNaN(created) && created <= before;
      });
    }
  }

  // Post-filter: SIC codes (requires fetching individual profiles for SIC data)
  // The search API doesn't return SIC codes, so we note it but can't filter here
  // without additional API calls. For SIC filtering, users should use bulk_search (Pro).

  const filteredCount = items.length;
  items = items.slice(0, limit);

  const companies = items.map(item => ({
    company_name: item.title,
    company_number: item.company_number,
    company_status: item.company_status ?? 'unknown',
    company_type: item.company_type ?? 'unknown',
    sector: 'Use deep_due_diligence with company_number for sector classification',
    date_of_creation: item.date_of_creation ?? null,
    date_of_cessation: item.date_of_cessation ?? null,
    registered_address: item.address_snippet ?? formatAddress(item.address),
    snippet: item.snippet ?? null,
  }));

  return {
    companies,
    total_results: searchResult.total_results ?? 0,
    filtered_count: filteredCount,
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

function formatAddress(address: Record<string, string | undefined> | undefined): string {
  if (!address) return 'No address available';
  const parts = [
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ].filter(Boolean);
  return parts.join(', ') || 'No address available';
}
