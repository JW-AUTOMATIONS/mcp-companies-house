/**
 * MCP Protocol Validation Script
 * Tests the server through the official MCP client SDK — same path as Inspector and real clients.
 * Validates: tool registration, schema rendering, valid calls, garbage input handling.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const SERVER_PATH = resolve(import.meta.dirname, '..', 'dist', 'index.js');

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function pass(name: string, detail = '') {
  results.push({ name, passed: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

async function main() {
  const apiKey = process.env.CH_API_KEY;
  if (!apiKey) {
    console.error('CH_API_KEY required');
    process.exit(1);
  }

  console.log('Starting MCP server via stdio transport...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, CH_API_KEY: apiKey },
  });

  const client = new Client({ name: 'validator', version: '1.0.0' });
  await client.connect(transport);

  // ── Phase 1A: Tool Registration ──
  console.log('Phase 1A: Tool Registration');

  const { tools } = await client.listTools();
  const toolNames = tools.map(t => t.name).sort();

  const expectedTools = [
    'detect_filing_anomalies',
    'deep_due_diligence',
    'get_company_profile',
    'map_director_network',
    'search_company',
    'search_officers',
    'trace_ownership_chain',
  ].sort();

  if (JSON.stringify(toolNames) === JSON.stringify(expectedTools)) {
    pass(`All 7 tools registered`, toolNames.join(', '));
  } else {
    fail('Tool registration', `Expected ${expectedTools.join(',')} got ${toolNames.join(',')}`);
  }

  // Verify each tool has a schema
  for (const tool of tools) {
    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      const props = (tool.inputSchema as Record<string, unknown>).properties;
      if (props && Object.keys(props as object).length > 0) {
        pass(`${tool.name} has input schema`, `${Object.keys(props as object).join(', ')}`);
      } else {
        fail(`${tool.name} schema`, 'No properties in inputSchema');
      }
    } else {
      fail(`${tool.name} schema`, 'Missing inputSchema');
    }
  }

  // Verify descriptions are non-empty and reasonable
  for (const tool of tools) {
    if (tool.description && tool.description.length > 30) {
      pass(`${tool.name} description`, `${tool.description.length} chars`);
    } else {
      fail(`${tool.name} description`, `Too short or missing: "${tool.description}"`);
    }
  }

  // ── Phase 1B: Valid Inputs (Live API) ──
  console.log('\nPhase 1B: Valid Inputs (Live API)');

  // search_company
  const searchResult = await client.callTool({
    name: 'search_company',
    arguments: { query: 'Tesco' },
  });
  const searchData = parseContent(searchResult);
  if (searchData?.companies?.length > 0) {
    pass('search_company("Tesco")', `${searchData.companies.length} results, total: ${searchData.total_results}`);
  } else {
    fail('search_company("Tesco")', JSON.stringify(searchData).slice(0, 200));
  }

  // get_company_profile — use Tesco's number
  const profileResult = await client.callTool({
    name: 'get_company_profile',
    arguments: { company_number: '00445790' },
  });
  const profileData = parseContent(profileResult);
  if (profileData?.company_name?.toUpperCase().includes('TESCO')) {
    pass('get_company_profile("00445790")', profileData.company_name);
  } else {
    fail('get_company_profile("00445790")', JSON.stringify(profileData).slice(0, 200));
  }

  // deep_due_diligence
  const ddResult = await client.callTool({
    name: 'deep_due_diligence',
    arguments: { company_number: '00445790' },
  });
  const ddData = parseContent(ddResult);
  if (ddData?.summary && ddData?.risk && ddData?.company) {
    pass('deep_due_diligence("00445790")', `risk: ${ddData.risk.overall}, summary: ${ddData.summary.slice(0, 80)}`);
  } else {
    fail('deep_due_diligence("00445790")', JSON.stringify(ddData).slice(0, 200));
  }

  // detect_filing_anomalies
  const anomalyResult = await client.callTool({
    name: 'detect_filing_anomalies',
    arguments: { company_number: '00445790' },
  });
  const anomalyData = parseContent(anomalyResult);
  if (anomalyData?.filing_health) {
    pass('detect_filing_anomalies("00445790")', `health: ${anomalyData.filing_health}, anomalies: ${anomalyData.anomalies?.length ?? 0}`);
  } else {
    fail('detect_filing_anomalies("00445790")', JSON.stringify(anomalyData).slice(0, 200));
  }

  // trace_ownership_chain — use a smaller company (Tesco is a PLC with many PSCs)
  const ownerResult = await client.callTool({
    name: 'trace_ownership_chain',
    arguments: { company_number: '10711992' }, // A small company likely to have simple PSC structure
  });
  const ownerData = parseContent(ownerResult);
  if (ownerData?.company || ownerData?.chain || ownerData?.warnings) {
    pass('trace_ownership_chain("10711992")', `chain levels: ${ownerData.chain?.length ?? 0}, UBOs: ${ownerData.ultimate_beneficial_owners?.length ?? 0}`);
  } else {
    fail('trace_ownership_chain("10711992")', JSON.stringify(ownerData).slice(0, 200));
  }

  // search_officers
  const officerSearchResult = await client.callTool({
    name: 'search_officers',
    arguments: { query: 'Ken Murphy' },
  });
  const officerSearchData = parseContent(officerSearchResult);
  if (officerSearchData?.officers?.length > 0) {
    pass('search_officers("Ken Murphy")', `${officerSearchData.officers.length} results, first: ${officerSearchData.officers[0]?.name}`);
  } else {
    fail('search_officers("Ken Murphy")', JSON.stringify(officerSearchData).slice(0, 200));
  }

  // map_director_network — use officer_id from search
  const officerId = officerSearchData?.officers?.[0]?.officer_id;
  if (officerId) {
    const networkResult = await client.callTool({
      name: 'map_director_network',
      arguments: { officer_id: officerId },
    });
    const networkData = parseContent(networkResult);
    if (networkData?.appointments?.length > 0 || networkData?.person) {
      pass('map_director_network', `appointments: ${networkData.appointments?.length ?? 0}, co-directors: ${networkData.co_directors?.length ?? 0}`);
    } else {
      fail('map_director_network', JSON.stringify(networkData).slice(0, 200));
    }
  } else {
    fail('map_director_network', 'No officer_id from search_officers to test with');
  }

  // ── Phase 1C: Garbage Inputs ──
  console.log('\nPhase 1C: Garbage Inputs (Error Handling)');

  // Empty company number
  const emptyResult = await client.callTool({
    name: 'get_company_profile',
    arguments: { company_number: '' },
  });
  if (isErrorResult(emptyResult)) {
    pass('Empty company_number → error', extractErrorMessage(emptyResult));
  } else {
    fail('Empty company_number', 'Expected error, got success');
  }

  // Non-existent company
  const fakeResult = await client.callTool({
    name: 'get_company_profile',
    arguments: { company_number: '99999999' },
  });
  if (isErrorResult(fakeResult)) {
    pass('Non-existent company → error', extractErrorMessage(fakeResult));
  } else {
    fail('Non-existent company', 'Expected error, got success');
  }

  // Invalid format company number
  const badFormatResult = await client.callTool({
    name: 'get_company_profile',
    arguments: { company_number: 'ZZZZXXXX' },
  });
  if (isErrorResult(badFormatResult)) {
    pass('Invalid format "ZZZZXXXX" → error', extractErrorMessage(badFormatResult));
  } else {
    fail('Invalid format company number', 'Expected error, got success');
  }

  // Empty search query
  const emptySearchResult = await client.callTool({
    name: 'search_company',
    arguments: { query: '' },
  });
  if (isErrorResult(emptySearchResult)) {
    pass('Empty search query → error', extractErrorMessage(emptySearchResult));
  } else {
    fail('Empty search query', 'Expected error, got success');
  }

  // Empty officer search
  const emptyOfficerResult = await client.callTool({
    name: 'search_officers',
    arguments: { query: '' },
  });
  if (isErrorResult(emptyOfficerResult)) {
    pass('Empty officer search → error', extractErrorMessage(emptyOfficerResult));
  } else {
    fail('Empty officer search', 'Expected error, got success');
  }

  // Empty officer_id for network
  const emptyNetworkResult = await client.callTool({
    name: 'map_director_network',
    arguments: { officer_id: '' },
  });
  if (isErrorResult(emptyNetworkResult)) {
    pass('Empty officer_id → error', extractErrorMessage(emptyNetworkResult));
  } else {
    fail('Empty officer_id', 'Expected error, got success');
  }

  // Garbage due diligence
  const garbageDdResult = await client.callTool({
    name: 'deep_due_diligence',
    arguments: { company_number: 'not-a-number' },
  });
  if (isErrorResult(garbageDdResult)) {
    pass('Garbage company_number for DD → error', extractErrorMessage(garbageDdResult));
  } else {
    fail('Garbage company_number for DD', 'Expected error, got success');
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
  }

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

function parseContent(result: unknown): Record<string, unknown> | null {
  try {
    const r = result as { content?: Array<{ text?: string }> };
    const text = r?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isErrorResult(result: unknown): boolean {
  const r = result as { isError?: boolean; content?: Array<{ text?: string }> };
  if (r?.isError) return true;
  const parsed = parseContent(result);
  return parsed?.code !== undefined && parsed?.message !== undefined;
}

function extractErrorMessage(result: unknown): string {
  const parsed = parseContent(result);
  if (parsed?.message) return String(parsed.message).slice(0, 100);
  const r = result as { content?: Array<{ text?: string }> };
  return r?.content?.[0]?.text?.slice(0, 100) ?? 'unknown error';
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
