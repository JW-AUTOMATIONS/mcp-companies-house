/**
 * Real-World Tool Chain Validation
 * Tests compound queries the way a real LLM would chain them.
 * Verifies data handoffs: company numbers, officer IDs, identifiers pass cleanly between tools.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const SERVER_PATH = resolve(import.meta.dirname, '..', 'dist', 'index.js');

interface TestResult { name: string; passed: boolean; detail: string }
const results: TestResult[] = [];

function pass(name: string, detail = '') {
  results.push({ name, passed: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

function parseContent(result: unknown): Record<string, unknown> | null {
  try {
    const r = result as { content?: Array<{ text?: string }> };
    return JSON.parse(r?.content?.[0]?.text ?? '');
  } catch { return null; }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env },
  });
  const client = new Client({ name: 'chain-validator', version: '1.0.0' });
  await client.connect(transport);

  // ── Chain 1: "Who runs this company?" ──
  // search_company → get_company_profile → map_director_network
  console.log('Chain 1: "Who runs this company?" (search → profile → director network)');

  const search1 = parseContent(await client.callTool({
    name: 'search_company',
    arguments: { query: 'Brewdog', limit: 3 },
  }));
  const companies = search1?.companies as Array<Record<string, unknown>>;
  if (!companies?.length) { fail('Chain 1: search', 'No results'); } else {
    pass('Chain 1: search_company("Brewdog")', `${companies.length} results`);

    // Extract company_number from search result → pass to profile
    const companyNumber = companies[0].company_number as string;
    if (!companyNumber) { fail('Chain 1: company_number extraction', 'Null company_number in search result'); } else {
      pass('Chain 1: company_number handoff', companyNumber);

      const profile = parseContent(await client.callTool({
        name: 'get_company_profile',
        arguments: { company_number: companyNumber },
      }));
      if (!profile?.company_name) { fail('Chain 1: profile', 'No profile data'); } else {
        pass('Chain 1: get_company_profile', `${profile.company_name}`);

        // Now get DD to find officer_ids for director network
        const dd = parseContent(await client.callTool({
          name: 'deep_due_diligence',
          arguments: { company_number: companyNumber },
        }));
        const officers = dd?.officers as Record<string, unknown>;
        const currentOfficers = officers?.current as Array<Record<string, unknown>>;
        if (!currentOfficers?.length) { fail('Chain 1: officers', 'No current officers in DD'); } else {
          // Find first officer with officer_id
          const officerWithId = currentOfficers.find(o => o.officer_id);
          if (!officerWithId?.officer_id) {
            fail('Chain 1: officer_id extraction', 'No officer_id in DD officers — handoff to map_director_network broken');
          } else {
            pass('Chain 1: officer_id handoff from DD', `${officerWithId.name} → ${officerWithId.officer_id}`);

            const network = parseContent(await client.callTool({
              name: 'map_director_network',
              arguments: { officer_id: officerWithId.officer_id as string },
            }));
            if (!network?.appointments) { fail('Chain 1: network', 'No appointments'); } else {
              pass('Chain 1: map_director_network', `${(network.appointments as unknown[]).length} appointments, ${(network.co_directors as unknown[])?.length ?? 0} co-directors`);
            }
          }
        }
      }
    }
  }

  // ── Chain 2: "Is this company dodgy?" ──
  // search_company → deep_due_diligence → detect_filing_anomalies → trace_ownership_chain
  console.log('\nChain 2: "Is this company dodgy?" (search → DD → anomalies → ownership)');

  const search2 = parseContent(await client.callTool({
    name: 'search_company',
    arguments: { query: 'Carillion', limit: 5, status: 'all' },
  }));
  const companies2 = search2?.companies as Array<Record<string, unknown>>;
  if (!companies2?.length) { fail('Chain 2: search', 'No results'); } else {
    // Find Carillion PLC specifically (collapsed company — good stress test)
    const carillion = companies2.find(c =>
      (c.company_name as string)?.toUpperCase().includes('CARILLION') &&
      (c.company_name as string)?.toUpperCase().includes('PLC')
    ) ?? companies2[0];
    const cn = carillion.company_number as string;
    pass('Chain 2: search_company("Carillion")', `Found: ${carillion.company_name} (${cn})`);

    // DD
    const dd = parseContent(await client.callTool({
      name: 'deep_due_diligence',
      arguments: { company_number: cn },
    }));
    if (dd?.risk) {
      const risk = dd.risk as Record<string, unknown>;
      pass('Chain 2: deep_due_diligence', `risk: ${risk.overall}, score: ${risk.score}`);
    } else {
      fail('Chain 2: DD', JSON.stringify(dd).slice(0, 100));
    }

    // Filing anomalies — uses same company_number
    const anomalies = parseContent(await client.callTool({
      name: 'detect_filing_anomalies',
      arguments: { company_number: cn, lookback_months: 60 },
    }));
    if (anomalies?.filing_health) {
      const anomalyList = anomalies.anomalies as Array<Record<string, unknown>>;
      pass('Chain 2: detect_filing_anomalies', `health: ${anomalies.filing_health}, ${anomalyList?.length ?? 0} anomalies`);
    } else {
      fail('Chain 2: anomalies', JSON.stringify(anomalies).slice(0, 100));
    }

    // Ownership chain — uses same company_number
    const ownership = parseContent(await client.callTool({
      name: 'trace_ownership_chain',
      arguments: { company_number: cn },
    }));
    if (ownership?.chain !== undefined || ownership?.warnings) {
      const ubos = ownership?.ultimate_beneficial_owners as unknown[];
      const warnings = ownership?.warnings as string[];
      pass('Chain 2: trace_ownership_chain', `UBOs: ${ubos?.length ?? 0}, warnings: ${warnings?.length ?? 0}`);
    } else {
      fail('Chain 2: ownership', JSON.stringify(ownership).slice(0, 100));
    }
  }

  // ── Chain 3: "Find me everyone connected to this director" ──
  // search_officers → map_director_network (multiple companies)
  console.log('\nChain 3: "Find everyone connected to this director" (officer search → network)');

  const officerSearch = parseContent(await client.callTool({
    name: 'search_officers',
    arguments: { query: 'James Watt', limit: 5 },
  }));
  const officers3 = officerSearch?.officers as Array<Record<string, unknown>>;
  if (!officers3?.length) { fail('Chain 3: search', 'No results'); } else {
    pass('Chain 3: search_officers("James Watt")', `${officers3.length} results`);

    // Verify officer_id is present and usable
    const withIds = officers3.filter(o => o.officer_id);
    if (withIds.length === 0) {
      fail('Chain 3: officer_id extraction', 'No officer_ids in search results — handoff to network broken');
    } else {
      pass('Chain 3: officer_id availability', `${withIds.length}/${officers3.length} have officer_id`);

      // Pick first and map their network
      const target = withIds[0];
      const network = parseContent(await client.callTool({
        name: 'map_director_network',
        arguments: { officer_id: target.officer_id as string, include_resigned: true },
      }));
      if (network?.appointments) {
        const appts = network.appointments as Array<Record<string, unknown>>;
        const coDirectors = network.co_directors as Array<Record<string, unknown>>;
        pass('Chain 3: map_director_network', `${target.name}: ${appts.length} appointments, ${coDirectors?.length ?? 0} co-directors`);

        // Verify company_numbers in appointments are valid format for feeding back into other tools
        const companyNumbers = appts.map(a => a.company_number).filter(Boolean);
        const validFormat = companyNumbers.every(cn =>
          typeof cn === 'string' && (/^\d{8}$/.test(cn) || /^[A-Z]{2}\d{6}$/.test(cn))
        );
        if (validFormat && companyNumbers.length > 0) {
          pass('Chain 3: company_numbers in appointments are valid format', `${companyNumbers.length} valid numbers`);
        } else {
          fail('Chain 3: company_number format', `Invalid format in: ${companyNumbers.slice(0, 5).join(', ')}`);
        }

        // Take first company from appointments and feed into DD — full circle
        if (companyNumbers.length > 0) {
          const circleDd = parseContent(await client.callTool({
            name: 'deep_due_diligence',
            arguments: { company_number: companyNumbers[0] as string },
          }));
          if (circleDd?.company) {
            pass('Chain 3: full circle (network → DD)', `Company: ${(circleDd.company as Record<string, unknown>).name}`);
          } else {
            fail('Chain 3: full circle', JSON.stringify(circleDd).slice(0, 100));
          }
        }
      } else {
        fail('Chain 3: network', JSON.stringify(network).slice(0, 100));
      }
    }
  }

  // ── Chain 4: Cross-format company number test ──
  // Verify tools handle the company_number formats produced by other tools
  console.log('\nChain 4: Cross-format company number handoff');

  // Scottish company (SC prefix)
  const scotSearch = parseContent(await client.callTool({
    name: 'search_company',
    arguments: { query: 'Aggreko', limit: 3 },
  }));
  const scotCompanies = scotSearch?.companies as Array<Record<string, unknown>>;
  const scotCo = scotCompanies?.find(c => (c.company_number as string)?.startsWith('SC'));
  if (scotCo) {
    const scotCn = scotCo.company_number as string;
    pass('Chain 4: Found SC-prefix company', `${scotCo.company_name} (${scotCn})`);

    // Feed SC number through profile and DD
    const scotProfile = parseContent(await client.callTool({
      name: 'get_company_profile',
      arguments: { company_number: scotCn },
    }));
    if (scotProfile?.company_name) {
      pass('Chain 4: SC number → profile', `${scotProfile.company_name}`);
    } else {
      fail('Chain 4: SC number → profile', 'Failed');
    }

    const scotDd = parseContent(await client.callTool({
      name: 'deep_due_diligence',
      arguments: { company_number: scotCn },
    }));
    if (scotDd?.summary) {
      pass('Chain 4: SC number → DD', 'Success');
    } else {
      fail('Chain 4: SC number → DD', 'Failed');
    }
  } else {
    pass('Chain 4: No SC company found in Aggreko search', 'Skipping SC-specific test');
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

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
