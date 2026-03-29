import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import { CompanyNotFoundError } from '../shared/errors.js';
import { createLogger, LogLevel } from '../shared/logger.js';

const logger = createLogger('ownership-chain', LogLevel.INFO);

export const TraceOwnershipChainInputSchema = {
  company_number: z.string().describe('8-digit UK company number to trace ownership for'),
  max_depth: z.number().min(1).max(10).optional().describe('Maximum depth to trace. Default: 5, max: 10'),
};

export interface OwnershipEntity {
  name: string;
  type: 'person' | 'company' | 'other';
  jurisdiction: string | null;
  company_number: string | null;
  ownership_percentage: string | null;
  natures_of_control: string[];
}

export interface OwnershipLevel {
  level: number;
  company_name: string;
  company_number: string;
  entities: OwnershipEntity[];
}

export interface OwnershipChainResult {
  company: string;
  company_number: string;
  chain: OwnershipLevel[];
  ultimate_beneficial_owners: Array<{
    name: string;
    type: string;
    trail: string[];
  }>;
  warnings: string[];
  attribution: string;
}

export async function traceOwnershipChain(
  client: ChApiClient,
  input: { company_number: string; max_depth?: number },
): Promise<OwnershipChainResult> {
  const maxDepth = input.max_depth ?? 5;
  const chain: OwnershipLevel[] = [];
  const warnings: string[] = [];
  const ubos: Array<{ name: string; type: string; trail: string[] }> = [];
  const visited = new Set<string>();

  // Get root company name
  const { data: rootProfile } = await client.getCompanyProfile(input.company_number);
  const rootName = rootProfile.company_name;

  // Recursive trace
  await traceLevel(
    client, input.company_number, rootName,
    0, maxDepth, chain, ubos, warnings, visited, [rootName],
  );

  return {
    company: rootName,
    company_number: input.company_number,
    chain,
    ultimate_beneficial_owners: ubos,
    warnings,
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

async function traceLevel(
  client: ChApiClient,
  companyNumber: string,
  companyName: string,
  depth: number,
  maxDepth: number,
  chain: OwnershipLevel[],
  ubos: Array<{ name: string; type: string; trail: string[] }>,
  warnings: string[],
  visited: Set<string>,
  trail: string[],
): Promise<void> {
  if (visited.has(companyNumber)) {
    warnings.push(`Circular ownership detected: ${companyNumber} (${companyName}) appears multiple times in the chain`);
    return;
  }
  visited.add(companyNumber);

  if (depth >= maxDepth) {
    warnings.push(`Max depth (${maxDepth}) reached at ${companyName} (${companyNumber}). Ownership chain may continue further.`);
    return;
  }

  let pscs;
  try {
    const result = await client.getPscs(companyNumber);
    pscs = result.data;
  } catch (err) {
    if (err instanceof CompanyNotFoundError) {
      warnings.push(`No PSC data available for ${companyName} (${companyNumber})`);
      return;
    }
    throw err;
  }

  const activePscs = pscs.items.filter(p => !p.ceased && !p.ceased_on);

  if (activePscs.length === 0) {
    warnings.push(`No active PSCs found for ${companyName} (${companyNumber})`);
    return;
  }

  const entities: OwnershipEntity[] = [];

  for (const psc of activePscs) {
    const isCorporate = psc.kind?.includes('corporate') ?? false;
    const ownershipPct = extractOwnershipPercentage(psc.natures_of_control);

    const entity: OwnershipEntity = {
      name: psc.name,
      type: isCorporate ? 'company' : (psc.kind?.includes('legal') ? 'other' : 'person'),
      jurisdiction: psc.identification?.place_registered ?? null,
      company_number: psc.identification?.registration_number ?? null,
      ownership_percentage: ownershipPct,
      natures_of_control: psc.natures_of_control,
    };
    entities.push(entity);

    if (isCorporate && entity.company_number) {
      // Check if this is a UK company we can trace further
      const isUkCompany = /^[A-Z]{0,2}\d{6,8}$/.test(entity.company_number);
      if (isUkCompany) {
        const childTrail = [...trail, psc.name];
        await traceLevel(
          client, entity.company_number, psc.name,
          depth + 1, maxDepth, chain, ubos, warnings, visited, childTrail,
        );
      } else {
        warnings.push(
          `Chain ends at non-UK entity: ${psc.name} (${entity.company_number}) — cannot trace further`
        );
        ubos.push({ name: psc.name, type: 'foreign_company', trail: [...trail, psc.name] });
      }
    } else if (!isCorporate) {
      // This is an individual or legal person — an ultimate beneficial owner
      ubos.push({ name: psc.name, type: entity.type, trail: [...trail, psc.name] });
    }
  }

  chain.push({
    level: depth,
    company_name: companyName,
    company_number: companyNumber,
    entities,
  });
}

function extractOwnershipPercentage(naturesOfControl: string[]): string | null {
  for (const nature of naturesOfControl) {
    // Percentage-band controls (shares or voting rights)
    if (nature.includes('75-to-100')) return '75-100%';
    if (nature.includes('50-to-75')) return '50-75%';
    if (nature.includes('25-to-50')) return '25-50%';
    // Threshold-based controls
    if (nature.includes('more-than-50')) return '>50%';
    if (nature.includes('more-than-25')) return '>25%';
  }

  // Non-percentage control types
  for (const nature of naturesOfControl) {
    if (nature.includes('significant-influence')) return 'significant influence';
    if (nature.includes('right-to-appoint') || nature.includes('appointment-of')) return 'board appointment rights';
    if (nature.includes('general-partner')) return 'general partner';
    if (nature.includes('limited-partner')) return 'limited partner';
    if (nature.includes('managing-officer')) return 'managing officer';
  }
  return null;
}
