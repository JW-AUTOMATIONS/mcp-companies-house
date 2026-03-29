# Companies House Intelligence MCP Server

An intelligent MCP server for UK company data. Not an API wrapper — a compound intelligence layer built on the free Companies House API, covering **5M+ UK companies**.

## What This Does

Five compound tools that go far beyond raw API access:

| Tool | What It Does |
|------|-------------|
| `search_company` | Search UK companies by name with filtering by status, region, SIC code, and incorporation date range |
| `deep_due_diligence` | Single-call company intelligence: profile, officers, PSCs, charges, insolvency, filings — with risk scoring and sector classification |
| `trace_ownership_chain` | Recursively trace beneficial ownership through corporate PSC chains. Detects circular structures and flags foreign entities |
| `map_director_network` | Map all appointments for an officer, find co-directors across companies, flag serial directors and formation agents |
| `detect_filing_anomalies` | Analyse filing history for red flags: overdue accounts, address churn, director turnover, filing gaps |

## When to Use

- **KYC/AML checks** — `deep_due_diligence` gives you a full risk assessment in one call
- **Beneficial ownership verification** — `trace_ownership_chain` follows corporate PSCs to ultimate beneficial owners
- **Director background checks** — `map_director_network` reveals all connected companies and co-directors
- **Compliance monitoring** — `detect_filing_anomalies` flags overdue filings, unusual patterns, and deteriorating filing health
- **Company research** — `search_company` finds companies matching specific criteria

## When NOT to Use

- Real-time trading decisions (data has caching, not suitable for HFT)
- Non-UK companies (this covers Companies House England & Wales, Scotland, and Northern Ireland only)
- Accessing private/restricted company data (this uses the free public API only)

## Quick Start

### 1. Get a Free API Key

Register at [Companies House Developer Hub](https://developer.company-information.service.gov.uk/) — it's free and takes 2 minutes.

### 2. Install

```bash
npm install -g @passiveinc/mcp-companies-house
```

### 3. Configure

Add to your MCP client configuration:

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

Or run directly:

```bash
CH_API_KEY=your-key-here mcp-companies-house
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CH_API_KEY` | Yes | Companies House API key ([get one free](https://developer.company-information.service.gov.uk/)) |
| `CH_CACHE_PATH` | No | SQLite cache file path. Default: `~/.cache/mcp-companies-house/cache.db` |
| `CH_PRO_KEY` | No | Pro tier key for shorter cache TTLs (fresher data) |

## Tool Details

### `search_company`

Search 5M+ UK companies with optional post-filtering.

**Input:**
- `query` (required) — Company name or keyword
- `status` — Filter: `active`, `dissolved`, `liquidation`, `receivership`, `administration`
- `region` — Filter by registered address region (fuzzy match)
- `incorporated_after` — ISO date string
- `incorporated_before` — ISO date string
- `sic_codes` — Array of SIC codes to filter by
- `limit` — Max results (default 10, max 50)

### `deep_due_diligence`

Comprehensive company report in a single call. Fetches 6 data sources in parallel.

**Input:**
- `company_number` (required) — 8-digit UK company number

**Returns:** Profile, officers, PSCs, charges, insolvency status, recent filings, risk assessment (low/medium/high with flags), sector classification, and data quality indicators.

### `trace_ownership_chain`

Follow beneficial ownership through corporate structures.

**Input:**
- `company_number` (required) — Starting company number
- `max_depth` — Max levels to trace (default 5, max 10)

**Returns:** Ownership chain with percentage bands, circular ownership detection, foreign entity warnings, and ultimate beneficial owners.

### `map_director_network`

Map an officer's company network.

**Input:**
- `officer_id` (required) — Companies House officer ID
- `include_resigned` — Include resigned appointments (default false)

**Returns:** All appointments, co-director map (who they serve with across companies), tenure statistics, and flags for serial directors (10+) and formation agents (25+).

### `detect_filing_anomalies`

Analyse filing patterns for compliance red flags.

**Input:**
- `company_number` (required) — 8-digit UK company number
- `lookback_months` — Analysis period (default 24, max 120)

**Returns:** Filing health score (healthy/concerning/problematic), anomaly list with severity ratings, upcoming due dates, and filing breakdown by category.

## Architecture

- **Cache-first** — SQLite with WAL mode. Configurable TTL per data category. Stale cache served on API errors.
- **Rate limiting** — Token bucket respecting Companies House 600 req/5min limit.
- **Graceful degradation** — On 429/5xx/network errors, stale cached data is served with a `stale` flag rather than failing.
- **Zod validation** — All API responses validated against schemas. Malformed responses trigger cache fallback.

## Data Attribution

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## License

MIT
