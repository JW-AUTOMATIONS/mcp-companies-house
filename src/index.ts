#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import os from 'node:os';
import { CacheStore } from './cache/sqlite.js';
import { TokenBucketRateLimiter } from './shared/rate-limiter.js';
import { ChApiClient } from './api/client.js';
import { ChMcpError } from './shared/errors.js';
import { createLogger, LogLevel } from './shared/logger.js';
import { getCompanyProfile, GetCompanyProfileInputSchema } from './tools/get-company-profile.js';
import { searchCompany, SearchCompanyInputSchema } from './tools/search-company.js';
import { deepDueDiligence, DeepDueDiligenceInputSchema } from './tools/deep-due-diligence.js';
import { traceOwnershipChain, TraceOwnershipChainInputSchema } from './tools/trace-ownership-chain.js';
import { mapDirectorNetwork, MapDirectorNetworkInputSchema } from './tools/map-director-network.js';
import { detectFilingAnomalies, DetectFilingAnomaliesInputSchema } from './tools/detect-filing-anomalies.js';
import { searchOfficers, SearchOfficersInputSchema } from './tools/search-officers.js';
import { checkDisqualifications, CheckDisqualificationsInputSchema } from './tools/check-disqualifications.js';

const logger = createLogger('mcp-server', LogLevel.INFO);

const CH_API_KEY = process.env.CH_API_KEY;
if (!CH_API_KEY) {
  process.stderr.write(
    'ERROR: CH_API_KEY environment variable is required.\n' +
    'Get a free API key at https://developer.company-information.service.gov.uk/\n',
  );
  process.exit(1);
}

const DB_PATH = process.env.CH_CACHE_PATH ?? path.join(os.homedir(), '.cache', 'mcp-companies-house', 'cache.db');

const cacheDir = path.dirname(DB_PATH);
import fs from 'node:fs';
fs.mkdirSync(cacheDir, { recursive: true });

const cache = new CacheStore(DB_PATH);
const rateLimiter = new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 });
const isPro = process.env.CH_PRO_KEY ? true : false;
const isCompact = process.env.CH_COMPACT === '1' || process.env.CH_COMPACT === 'true';
const client = new ChApiClient({ apiKey: CH_API_KEY, cache, rateLimiter, isPro });

// Prune expired cache entries on startup (>7 days old across all categories)
import { CacheCategory } from './cache/ttl.js';
const PRUNE_MAX_AGE = 7 * 24 * 60 * 60;
for (const category of Object.values(CacheCategory)) {
  cache.prune(category, PRUNE_MAX_AGE);
}

const server = new McpServer(
  {
    name: 'companies-house-intelligence',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

function stripForCompact(data: unknown): unknown {
  if (!isCompact || typeof data !== 'object' || data === null) return data;
  const obj = data as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'attribution') continue;
    if (key === 'data_quality') continue;
    stripped[key] = value;
  }
  return stripped;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(stripForCompact(data)) }],
  };
}

function toolError(error: unknown) {
  if (error instanceof ChMcpError) {
    return error.toMcpError();
  }
  logger.error('Tool error', { error: error instanceof Error ? error : new Error(String(error)) });
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong while fetching data from Companies House. This is likely a temporary issue — please try again.',
    }) }],
  };
}

server.registerTool(
  'get_company_profile',
  {
    title: 'Get Company Profile',
    description:
      'Quick lookup for a single UK company when you already have its company number. Returns name, status, type, ' +
      'sector, registered address, SIC codes, filing deadlines, previous names, and key flags (charges, insolvency). ' +
      'Use this when the user asks basic questions like "what does company X do?" or "is this company still active?". ' +
      'If you only have a company name, call search_company first to find the number. For risk assessment or ' +
      'investment research, use deep_due_diligence instead — it includes everything this tool returns plus officers, ' +
      'ownership, charges, and a risk score.',
    inputSchema: GetCompanyProfileInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await getCompanyProfile(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'search_company',
  {
    title: 'Search UK Companies',
    description:
      'Find UK companies by name or keyword. This is your starting point when the user mentions a company by name ' +
      'without a company number — search first, then pass the returned company_number to other tools. ' +
      'Returns company number, name, status, address, and incorporation date for each match. ' +
      'Supports optional filtering by status (active/dissolved), region, SIC code, and incorporation date range. ' +
      'Covers 5M+ companies registered in England, Wales, Scotland, and Northern Ireland.',
    inputSchema: SearchCompanyInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await searchCompany(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'deep_due_diligence',
  {
    title: 'Deep Due Diligence Report',
    description:
      'Comprehensive company intelligence in a single call — the go-to tool when the user asks "is this company ' +
      'risky?", "should I invest in X?", "tell me everything about company Y", or any KYC/AML/supplier vetting question. ' +
      'Fetches profile, officers, PSCs (beneficial owners), charges, insolvency history, and recent filings in parallel. ' +
      'Returns a risk score (low/medium/high) with specific flags, a one-line summary, and structured data for each area. ' +
      'Prefer this over calling get_company_profile, search_officers, and other tools individually when the user wants ' +
      'a comprehensive view. Officer results include officer_id values you can pass to map_director_network.',
    inputSchema: DeepDueDiligenceInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await deepDueDiligence(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'trace_ownership_chain',
  {
    title: 'Trace Beneficial Ownership Chain',
    description:
      'Use when the user asks "who owns this company?", "who is the ultimate beneficial owner?", or wants to ' +
      'understand a corporate ownership structure. Recursively traces Persons with Significant Control (PSCs) ' +
      'through corporate chains to find ultimate beneficial owners. Detects circular ownership, flags foreign ' +
      'entities that cannot be traced further, and shows ownership percentage bands at each level. ' +
      'Supports up to 10 levels of nesting. For a broader risk picture that includes ownership alongside ' +
      'officers, charges, and filings, use deep_due_diligence instead.',
    inputSchema: TraceOwnershipChainInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await traceOwnershipChain(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'map_director_network',
  {
    title: 'Map Director Network',
    description:
      'Use when the user asks "what other companies does this director run?" or "who are their co-directors?". ' +
      'Maps all company appointments for an officer, identifies co-directors across companies, and flags ' +
      'serial directors (10+ companies) and formation agents (25+ companies). ' +
      'Requires an officer_id — get this from deep_due_diligence (in the officers array) or search_officers ' +
      '(search by person name). Do NOT pass a company number here; this tool takes a person identifier, not a company.',
    inputSchema: MapDirectorNetworkInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await mapDirectorNetwork(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'detect_filing_anomalies',
  {
    title: 'Detect Filing Anomalies',
    description:
      'Use when the user asks "are their filings up to date?", "is this company compliant?", or wants to monitor ' +
      'filing behaviour over time. Analyses filing history to detect red flags: overdue accounts, overdue confirmation ' +
      'statements, frequent address changes, rapid director turnover, habitual late filing, and gaps with no filings. ' +
      'Returns a filing health score (healthy/concerning/problematic), anomaly list with severity ratings, ' +
      'and upcoming due dates. Note: deep_due_diligence includes basic overdue flags — use this tool when you need ' +
      'the detailed filing pattern analysis.',
    inputSchema: DetectFilingAnomaliesInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await detectFilingAnomalies(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'search_officers',
  {
    title: 'Search UK Company Officers',
    description:
      'Search for company directors, secretaries, and other officers by name across all UK companies. ' +
      'Use when the user asks about a person — "what companies does John Smith direct?" or "find director Jane Doe". ' +
      'Returns officer name, appointment count, date of birth (month/year), and officer_id. ' +
      'Pass the returned officer_id to map_director_network to see their full company network and co-directors. ' +
      'If you already have a company number and want its directors, use deep_due_diligence instead — it returns ' +
      'officers with their officer_id included.',
    inputSchema: SearchOfficersInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await searchOfficers(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'check_disqualifications',
  {
    title: 'Check Director Disqualifications',
    description:
      'Use when the user asks "have any directors been disqualified?" or as part of KYC/AML due diligence. ' +
      'Takes a company number and checks ALL current directors against the Companies House disqualified officers ' +
      'register. Returns any active disqualification orders with dates, reasons, and related companies. ' +
      'A disqualified person acting as director is a criminal offence under UK law. ' +
      'Returns a clean: true/false flag for quick pass/fail checks.',
    inputSchema: CheckDisqualificationsInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return toolResult(await checkDisqualifications(client, args));
    } catch (error) {
      return toolError(error);
    }
  },
);

function shutdown() {
  logger.info('Shutting down MCP server');
  cache.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  // Validate API key before accepting connections
  const keyCheck = await client.validateApiKey();
  if (!keyCheck.valid) {
    process.stderr.write(`ERROR: ${keyCheck.message}\n`);
    process.exit(1);
  }
  logger.info(keyCheck.message);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Companies House Intelligence MCP server started', {
    version: '0.1.0',
    pro: isPro,
    compact: isCompact,
    cachePath: DB_PATH,
  });
}

main().catch((error) => {
  logger.error('Fatal error starting MCP server', { error: error instanceof Error ? error : new Error(String(error)) });
  cache.close();
  process.exit(1);
});
