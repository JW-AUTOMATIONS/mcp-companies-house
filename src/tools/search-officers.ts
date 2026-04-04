import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';

export const SearchOfficersInputSchema = {
  query: z.string().describe('Officer name to search for, e.g. "Ken Murphy"'),
  limit: z.number().min(1).max(50).optional().describe('Max results to return. Default: 10, max: 50'),
};

export async function searchOfficers(
  client: ChApiClient,
  input: { query: string; limit?: number },
) {
  const limit = input.limit ?? 10;
  const { data } = await client.searchOfficers(input.query, 0, limit);

  return {
    total_results: data.total_results,
    officers: data.items.map(item => {
      const officerId = item.links.self.match(/\/officers\/([^/]+)/)?.[1] ?? null;
      const result: Record<string, unknown> = {
        name: item.title,
        appointment_count: item.appointment_count,
        officer_id: officerId,
      };
      if (item.date_of_birth) {
        result.date_of_birth = `${item.date_of_birth.year}-${String(item.date_of_birth.month).padStart(2, '0')}`;
      }
      if (item.address_snippet) result.address = item.address_snippet;
      return result;
    }),
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}
