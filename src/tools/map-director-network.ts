import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import type { OfficerAppointmentItem } from '../api/types.js';

export const MapDirectorNetworkInputSchema = {
  officer_id: z.string().describe('Officer ID from a previous search or due-diligence result'),
  include_resigned: z.boolean().optional().describe('Include resigned appointments. Default: false'),
};

export interface CoDirector {
  name: string;
  shared_companies: string[];
  shared_count: number;
}

export interface DirectorNetworkResult {
  person: {
    name: string | null;
    date_of_birth: { month: number; year: number } | null;
  };
  appointments: Array<{
    company_name: string;
    company_number: string;
    company_status: string;
    role: string;
    appointed_on: string | null;
    resigned_on: string | null;
  }>;
  co_directors: CoDirector[];
  statistics: {
    total_appointments: number;
    active_appointments: number;
    dissolved_companies: number;
    average_tenure_months: number;
  };
  flags: string[];
  attribution: string;
}

export async function mapDirectorNetwork(
  client: ChApiClient,
  input: { officer_id: string; include_resigned?: boolean },
): Promise<DirectorNetworkResult> {
  const includeResigned = input.include_resigned ?? false;

  // Fetch all appointments (paginated)
  const allItems: OfficerAppointmentItem[] = [];
  let startIndex = 0;
  let name: string | null = null;
  let dob: { month: number; year: number } | null = null;

  while (true) {
    const { data } = await client.getOfficerAppointments(input.officer_id, startIndex, 50);

    if (!name && data.name) name = data.name;
    if (!dob && data.date_of_birth) dob = data.date_of_birth;

    allItems.push(...data.items);

    if (allItems.length >= data.total_results) break;
    startIndex += data.items_per_page;
  }

  // Filter by active/resigned
  const appointments = includeResigned
    ? allItems
    : allItems.filter(a => !a.resigned_on);

  // Build appointments list
  const appointmentsList = appointments.map(a => ({
    company_name: a.appointed_to?.company_name ?? 'Unknown',
    company_number: a.appointed_to?.company_number ?? 'Unknown',
    company_status: a.appointed_to?.company_status ?? 'unknown',
    role: a.officer_role,
    appointed_on: a.appointed_on ?? null,
    resigned_on: a.resigned_on ?? null,
  }));

  // Find co-directors by fetching officer lists for active companies
  const coDirectorMap = new Map<string, Set<string>>();
  const activeCompanyNumbers = appointments
    .filter(a => !a.resigned_on && a.appointed_to?.company_number)
    .map(a => a.appointed_to!.company_number!)
    .slice(0, 10); // Limit to prevent excessive API calls

  for (const cn of activeCompanyNumbers) {
    try {
      const { data: officers } = await client.getOfficers(cn);
      for (const officer of officers.items) {
        if (!officer.resigned_on && officer.name !== name) {
          const existing = coDirectorMap.get(officer.name) ?? new Set();
          const companyName = appointments.find(
            a => a.appointed_to?.company_number === cn
          )?.appointed_to?.company_name ?? cn;
          existing.add(companyName);
          coDirectorMap.set(officer.name, existing);
        }
      }
    } catch {
      // Skip companies where we can't fetch officers
    }
  }

  const coDirectors: CoDirector[] = [...coDirectorMap.entries()]
    .map(([dirName, companies]) => ({
      name: dirName,
      shared_companies: [...companies],
      shared_count: companies.size,
    }))
    .filter(cd => cd.shared_count >= 1)
    .sort((a, b) => b.shared_count - a.shared_count);

  // Calculate statistics
  const active = allItems.filter(a => !a.resigned_on);
  const dissolved = allItems.filter(a => a.appointed_to?.company_status === 'dissolved');
  const avgTenure = calculateAverageTenure(allItems);

  // Generate flags
  const flags: string[] = [];

  if (allItems.length >= 25) {
    flags.push(`Director of ${allItems.length}+ companies (possible formation agent pattern)`);
  } else if (allItems.length >= 10) {
    flags.push(`Director of ${allItems.length} companies (serial director)`);
  }

  if (dissolved.length >= 5) {
    flags.push(`${dissolved.length} dissolved companies in history`);
  }

  const multipleSharedDirectors = coDirectors.filter(cd => cd.shared_count >= 3);
  if (multipleSharedDirectors.length > 0) {
    flags.push(`Shares 3+ companies with: ${multipleSharedDirectors.map(cd => cd.name).join(', ')}`);
  }

  return {
    person: { name, date_of_birth: dob },
    appointments: appointmentsList,
    co_directors: coDirectors,
    statistics: {
      total_appointments: allItems.length,
      active_appointments: active.length,
      dissolved_companies: dissolved.length,
      average_tenure_months: avgTenure,
    },
    flags,
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

function calculateAverageTenure(items: OfficerAppointmentItem[]): number {
  const tenures: number[] = [];
  const now = new Date();

  for (const item of items) {
    if (!item.appointed_on) continue;
    const start = new Date(item.appointed_on);
    const end = item.resigned_on ? new Date(item.resigned_on) : now;
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (months >= 0) tenures.push(months);
  }

  if (tenures.length === 0) return 0;
  return Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length);
}
