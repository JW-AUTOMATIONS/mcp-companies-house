import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import { CompanyNotFoundError } from '../shared/errors.js';
import { normalizeCompanyNumber } from '../shared/company-number.js';
import { createLogger, LogLevel } from '../shared/logger.js';

const logger = createLogger('disqualifications', LogLevel.INFO);

export const CheckDisqualificationsInputSchema = {
  company_number: z.string().describe('UK company number, e.g. "00445790" or "SC123456". All current directors will be checked against the disqualified officers register.'),
};

export interface DisqualificationMatch {
  officer_name: string;
  officer_role: string;
  disqualified_from: string | null;
  disqualified_until: string | null;
  disqualification_type: string | null;
  reason: string | null;
  related_companies: string[];
}

export interface DisqualificationCheckResult {
  company_number: string;
  company_name: string;
  officers_checked: number;
  matches: DisqualificationMatch[];
  clean: boolean;
  attribution: string;
}

export async function checkDisqualifications(
  client: ChApiClient,
  input: { company_number: string },
): Promise<DisqualificationCheckResult> {
  const cn = normalizeCompanyNumber(input.company_number);

  const [profileResult, officersResult] = await Promise.all([
    client.getCompanyProfile(cn),
    client.getOfficers(cn),
  ]);

  const companyName = profileResult.data.company_name;
  const activeOfficers = officersResult.data.items.filter(o => !o.resigned_on);
  const matches: DisqualificationMatch[] = [];

  for (const officer of activeOfficers) {
    try {
      const { data: searchResult } = await client.searchDisqualifiedOfficers(officer.name, 0, 5);
      if (!searchResult.items?.length) continue;

      for (const item of searchResult.items) {
        if (!isNameMatch(officer.name, item.title)) continue;

        // Fetch full disqualification details
        const selfLink = item.links.self;
        const idMatch = selfLink.match(/\/disqualified-officers\/(natural|corporate)\/([^/]+)/);
        if (!idMatch) continue;

        try {
          const { data: detail } = await client.getDisqualifiedOfficer(idMatch[2], idMatch[1] as 'natural' | 'corporate');

          for (const disq of detail.disqualifications) {
            const until = disq.disqualified_until;
            if (until && new Date(until) < new Date()) continue; // expired

            matches.push({
              officer_name: officer.name,
              officer_role: officer.officer_role,
              disqualified_from: disq.disqualified_from ?? null,
              disqualified_until: until ?? null,
              disqualification_type: disq.disqualification_type ?? null,
              reason: disq.reason?.description_identifier?.replace(/-/g, ' ') ?? null,
              related_companies: disq.company_names ?? [],
            });
          }
        } catch (err) {
          if (err instanceof CompanyNotFoundError) continue;
          logger.warn('Failed to fetch disqualification detail', {
            officer: officer.name,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to search disqualified officers', {
        officer: officer.name,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return {
    company_number: cn,
    company_name: companyName,
    officers_checked: activeOfficers.length,
    matches,
    clean: matches.length === 0,
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

function isNameMatch(officerName: string, disqualifiedName: string): boolean {
  const normalize = (n: string) => n.toLowerCase().replace(/[,.\s]+/g, ' ').trim().split(' ').sort().join(' ');
  return normalize(officerName) === normalize(disqualifiedName);
}
