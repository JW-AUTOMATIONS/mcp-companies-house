# Companies House Intelligence MCP Server

An intelligent MCP server for UK company data — not an API wrapper. Compound intelligence tools built on the free Companies House API, covering **5M+ UK companies** across England, Wales, Scotland, and Northern Ireland.

**What makes this different:** Other Companies House MCP servers map 1:1 to API endpoints. This one does things the raw API can't — risk scoring, ownership chain tracing, director network mapping, filing anomaly detection, and disqualification checks — all in single tool calls.

## Quick Start

**1. Get a free API key** — [Companies House Developer Hub](https://developer.company-information.service.gov.uk/) (takes 2 minutes)

**2. Install**

```bash
npm install -g @passiveinc/mcp-companies-house
```

**3. Add to your MCP client** (Claude Desktop, Cursor, Cline, etc.)

```json
{
  "mcpServers": {
    "companies-house": {
      "command": "mcp-companies-house",
      "env": {
        "CH_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

That's it. Ask your AI assistant "tell me about Tesco" and it will use the tools automatically.

## Tools

| Tool | Use When | Example |
|------|----------|---------|
| `search_company` | You have a company name but no number | "Find Revolut" |
| `get_company_profile` | You need basic info for a known company | "What does company 00445790 do?" |
| `deep_due_diligence` | Risk assessment, KYC, AML, investment research | "Is this company risky?" |
| `trace_ownership_chain` | Finding ultimate beneficial owners | "Who really owns this company?" |
| `map_director_network` | Director background checks, finding connected companies | "What other companies does this director run?" |
| `detect_filing_anomalies` | Compliance monitoring, filing pattern analysis | "Are their filings up to date?" |
| `search_officers` | Finding a person across all UK companies | "Find director Jane Smith" |
| `check_disqualifications` | KYC/AML compliance — checking for banned directors | "Have any directors been disqualified?" |

### Tool Chaining

Tools are designed to chain naturally. The descriptions guide LLMs to pick the right tool and pass data between them:

- **Name to insight:** `search_company` → get company number → `deep_due_diligence`
- **Person to network:** `search_officers` → get officer_id → `map_director_network`
- **Company to owners:** `deep_due_diligence` → spot corporate PSCs → `trace_ownership_chain`
- **Risk check:** `deep_due_diligence` + `check_disqualifications` + `detect_filing_anomalies`

## Why This Server?

| | This server | Raw API wrappers |
|---|---|---|
| Risk scoring | Low/medium/high with specific flags | None — you get raw JSON |
| Ownership tracing | Recursive through corporate chains | Manual, one level at a time |
| Director networks | Cross-company mapping with co-directors | Single company only |
| Filing anomalies | Pattern detection with health scoring | Raw filing list |
| Disqualification checks | All directors checked automatically | Manual per-person lookup |
| Error handling | Graceful degradation with stale cache | Fails on API errors |
| Token efficiency | Compressed responses, null-stripped | Full API payloads |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CH_API_KEY` | Yes | Companies House API key ([free](https://developer.company-information.service.gov.uk/)) |
| `CH_CACHE_PATH` | No | SQLite cache path (default: `~/.cache/mcp-companies-house/cache.db`) |
| `CH_PRO_KEY` | No | Pro tier key for shorter cache TTLs |
| `CH_COMPACT` | No | Set to `1` for minimal responses (strips attribution/metadata) |

## Architecture

- **Cache-first**: SQLite with WAL mode, configurable TTL per data category. Stale cache served on API errors rather than failing.
- **Rate limiting**: Token bucket respecting the 600 requests/5 minutes Companies House limit.
- **Graceful degradation**: API errors, rate limits, and schema validation failures all fall back to cached data when available.
- **Zod validation**: All API responses validated. Malformed data triggers cache fallback, not crashes.
- **Startup validation**: API key verified on boot — fails fast with a clear message if invalid.

## Data Attribution

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## License

MIT
