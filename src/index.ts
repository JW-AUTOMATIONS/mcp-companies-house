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

function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(error: unknown) {
  if (error instanceof ChMcpError) {
    return error.toMcpError();
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  logger.error('Tool error', { error: error instanceof Error ? error : new Error(String(error)) });
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ code: 'INTERNAL_ERROR', message }) }],
  };
}

server.registerTool(
  'get_company_profile',
  {
    title: 'Get Company Profile',
    description:
      'Quick lookup for a single UK company by number. Returns name, status, type, sector, registered address, ' +
      'SIC codes, filing deadlines, previous names, and key flags (charges, insolvency). Lighter and faster than ' +
      'deep_due_diligence — use this when you just need basic company information. Auto-pads short company numbers.',
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
      'Search 5M+ UK companies by name, with optional filtering by status, region, SIC code, and incorporation date range. ' +
      'Returns company number, name, status, address, SIC codes, and incorporation date. ' +
      'Use when you need to find UK companies matching specific criteria.',
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
      'Comprehensive company intelligence in a single call. Fetches profile, officers, PSCs (beneficial owners), ' +
      'charges, insolvency history, and filing history in parallel. Returns structured risk assessment, sector classification, ' +
      'and data quality indicators. Use for KYC, AML checks, investment research, or supplier vetting on any UK company.',
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
      'Recursively traces Persons with Significant Control (PSCs) to find ultimate beneficial owners. ' +
      'Follows corporate ownership chains across UK companies, detects circular ownership structures, ' +
      'and flags foreign entities that cannot be traced further. Supports up to 10 levels of nesting. ' +
      'Use for beneficial ownership verification, AML compliance, and corporate structure analysis.',
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
      'Maps all company appointments for an officer, identifies co-directors across companies, and flags ' +
      'serial directors (10+ companies) and formation agents (25+ companies). Shows which directors frequently ' +
      'work together and calculates tenure statistics. Use for director due diligence, network analysis, and ' +
      'identifying connected company groups. Requires an officer_id from Companies House.',
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
      'Analyses a company\'s filing history to detect red flags: overdue accounts, overdue confirmation statements, ' +
      'frequent address changes, rapid director turnover, habitual late filing, and periods with no filings. ' +
      'Returns a filing health score (healthy/concerning/problematic), anomaly list with severity ratings, ' +
      'and upcoming due dates. Use for compliance monitoring, risk assessment, and ongoing company surveillance.',
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

function shutdown() {
  logger.info('Shutting down MCP server');
  cache.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Companies House Intelligence MCP server started', {
    version: '0.1.0',
    pro: isPro,
    cachePath: DB_PATH,
  });
}

main().catch((error) => {
  logger.error('Fatal error starting MCP server', { error: error instanceof Error ? error : new Error(String(error)) });
  cache.close();
  process.exit(1);
});
