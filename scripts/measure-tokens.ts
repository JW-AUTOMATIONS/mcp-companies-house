/**
 * Measures token consumption per tool response.
 * Uses character count / 4 as rough token estimate (standard for English text).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const SERVER_PATH = resolve(import.meta.dirname, '..', 'dist', 'index.js');

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env },
  });
  const client = new Client({ name: 'token-audit', version: '1.0.0' });
  await client.connect(transport);

  const tests = [
    { name: 'search_company', args: { query: 'Tesco', limit: 10 } },
    { name: 'get_company_profile', args: { company_number: '00445790' } },
    { name: 'deep_due_diligence', args: { company_number: '00445790' } },
    { name: 'detect_filing_anomalies', args: { company_number: '00445790' } },
    { name: 'trace_ownership_chain', args: { company_number: '10711992' } },
    { name: 'search_officers', args: { query: 'Ken Murphy', limit: 10 } },
    { name: 'map_director_network', args: { officer_id: 'lcVfLkoMq9WDl9EL79HSWq17mrI' } },
    { name: 'check_disqualifications', args: { company_number: '10711992' } },
  ];

  console.log('Tool Token Consumption Audit\n');
  console.log('Tool                        | Chars    | ~Tokens | Notable');
  console.log('----------------------------|----------|---------|--------');

  for (const test of tests) {
    const result = await client.callTool({ name: test.name, arguments: test.args });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const chars = text.length;
    const tokens = estimateTokens(text);

    // Analyze verbose patterns
    const parsed = JSON.parse(text);
    const notes: string[] = [];

    // Count null/empty values
    const nullCount = (text.match(/"[^"]+": null/g) || []).length;
    if (nullCount > 3) notes.push(`${nullCount} nulls`);

    // Count attribution fields
    const attrCount = (text.match(/"attribution"/g) || []).length;
    if (attrCount > 0) notes.push(`${attrCount} attribution`);

    // Check for ISO timestamps that could be relative
    const isoCount = (text.match(/\d{4}-\d{2}-\d{2}/g) || []).length;
    if (isoCount > 10) notes.push(`${isoCount} dates`);

    // Check indentation waste (JSON pretty-print)
    const indentChars = (text.match(/^ +/gm) || []).reduce((sum, s) => sum + s.length, 0);
    const indentPct = Math.round((indentChars / chars) * 100);
    if (indentPct > 10) notes.push(`${indentPct}% indent`);

    const padded = test.name.padEnd(28);
    console.log(`${padded}| ${String(chars).padStart(8)} | ${String(tokens).padStart(7)} | ${notes.join(', ')}`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
