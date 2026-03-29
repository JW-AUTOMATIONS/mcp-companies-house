import { z } from 'zod';
import type { ChApiClient } from '../api/client.js';
import type { CompanyProfile, FilingItem } from '../api/types.js';
import { normalizeCompanyNumber } from '../shared/company-number.js';

export const DetectFilingAnomaliesInputSchema = {
  company_number: z.string().describe('8-digit UK company number'),
  lookback_months: z.number().min(1).max(120).optional().describe('Months of filing history to analyse. Default: 24'),
};

export type AnomalyType =
  | 'overdue_accounts'
  | 'overdue_confirmation_statement'
  | 'late_filing'
  | 'frequent_address_change'
  | 'rapid_director_turnover'
  | 'accounts_filed_last_day'
  | 'missing_confirmation_statement'
  | 'no_recent_filings'
  | 'name_change';

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  date: string | null;
}

export interface FilingAnomalyResult {
  company_number: string;
  company_name: string;
  anomalies: Anomaly[];
  filing_health: 'healthy' | 'concerning' | 'problematic';
  next_due: Array<{ type: string; date: string }>;
  filing_summary: {
    total_in_period: number;
    by_category: Record<string, number>;
  };
  attribution: string;
}

export async function detectFilingAnomalies(
  client: ChApiClient,
  input: { company_number: string; lookback_months?: number },
): Promise<FilingAnomalyResult> {
  const cn = normalizeCompanyNumber(input.company_number);
  const lookbackMonths = input.lookback_months ?? 24;
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - lookbackMonths);

  const [profileResult, filingsResult] = await Promise.all([
    client.getCompanyProfile(cn),
    client.getFilingHistory(cn, 0, 100),
  ]);

  const profile = profileResult.data;
  const allFilings = filingsResult.data.items;

  // Filter to lookback period
  const filings = allFilings.filter(f => new Date(f.date) >= cutoffDate);

  const anomalies: Anomaly[] = [];

  checkOverdueAccounts(profile, anomalies);
  checkOverdueConfirmationStatement(profile, anomalies);
  checkAddressChanges(filings, lookbackMonths, anomalies);
  checkDirectorTurnover(filings, lookbackMonths, anomalies);
  checkLateFilingPattern(profile, allFilings, anomalies);
  checkNoRecentFilings(filings, profile, lookbackMonths, anomalies);
  checkNameChanges(filings, anomalies);

  // Calculate filing health
  const criticals = anomalies.filter(a => a.severity === 'critical').length;
  const warnings = anomalies.filter(a => a.severity === 'warning').length;

  let filingHealth: 'healthy' | 'concerning' | 'problematic';
  if (criticals >= 1) {
    filingHealth = 'problematic';
  } else if (warnings >= 2) {
    filingHealth = 'problematic';
  } else if (warnings >= 1 || anomalies.length >= 3) {
    filingHealth = 'concerning';
  } else {
    filingHealth = 'healthy';
  }

  // Next due dates
  const nextDue: Array<{ type: string; date: string }> = [];
  if (profile.accounts?.next_accounts?.due_on) {
    nextDue.push({ type: 'Annual Accounts', date: profile.accounts.next_accounts.due_on });
  }
  if (profile.confirmation_statement?.next_due) {
    nextDue.push({ type: 'Confirmation Statement', date: profile.confirmation_statement.next_due });
  }

  // Filing summary by category
  const byCategory: Record<string, number> = {};
  for (const f of filings) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  return {
    company_number: cn,
    company_name: profile.company_name,
    anomalies,
    filing_health: filingHealth,
    next_due: nextDue,
    filing_summary: {
      total_in_period: filings.length,
      by_category: byCategory,
    },
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  };
}

function checkOverdueAccounts(profile: CompanyProfile, anomalies: Anomaly[]): void {
  if (profile.accounts?.next_accounts?.overdue) {
    anomalies.push({
      type: 'overdue_accounts',
      severity: 'critical',
      description: `Annual accounts are overdue${profile.accounts.next_accounts.due_on ? ` (due ${profile.accounts.next_accounts.due_on})` : ''}`,
      date: profile.accounts.next_accounts.due_on ?? null,
    });
  }
}

function checkOverdueConfirmationStatement(profile: CompanyProfile, anomalies: Anomaly[]): void {
  if (profile.confirmation_statement?.overdue) {
    anomalies.push({
      type: 'overdue_confirmation_statement',
      severity: 'critical',
      description: `Confirmation statement is overdue${profile.confirmation_statement.next_due ? ` (due ${profile.confirmation_statement.next_due})` : ''}`,
      date: profile.confirmation_statement.next_due ?? null,
    });
  }
}

function checkAddressChanges(filings: FilingItem[], lookbackMonths: number, anomalies: Anomaly[]): void {
  const addressChanges = filings.filter(f => f.category === 'address');
  if (addressChanges.length >= 3) {
    anomalies.push({
      type: 'frequent_address_change',
      severity: 'warning',
      description: `${addressChanges.length} registered address changes in the last ${lookbackMonths} months`,
      date: addressChanges[0]?.date ?? null,
    });
  }
}

function checkDirectorTurnover(filings: FilingItem[], lookbackMonths: number, anomalies: Anomaly[]): void {
  // Officer termination filings
  const officerFilings = filings.filter(f =>
    f.category === 'officers' &&
    (f.type === 'TM01' || f.type === 'TM02' || f.description?.toLowerCase().includes('terminat') || f.description?.toLowerCase().includes('resign'))
  );

  if (officerFilings.length >= 3) {
    anomalies.push({
      type: 'rapid_director_turnover',
      severity: 'warning',
      description: `${officerFilings.length} officer termination/resignation filings in the last ${lookbackMonths} months`,
      date: officerFilings[0]?.date ?? null,
    });
  }
}

function checkLateFilingPattern(profile: CompanyProfile, allFilings: FilingItem[], anomalies: Anomaly[]): void {
  // Check if accounts are consistently filed near the deadline
  const accountsFilings = allFilings
    .filter(f => f.category === 'accounts')
    .slice(0, 3); // Last 3 accounts filings

  if (accountsFilings.length < 2) return;

  let lateCount = 0;
  for (const filing of accountsFilings) {
    // Private companies get 9 months from period end to file
    // We check if filing date is close to what the deadline would be
    // This is an approximation since we don't have the exact deadline per filing
    const filingDate = new Date(filing.date);
    const month = filingDate.getMonth();
    const day = filingDate.getDate();

    // If filed in the last 7 days of a month, it's likely last-minute
    if (day >= 24) {
      lateCount++;
    }
  }

  if (lateCount >= 2) {
    anomalies.push({
      type: 'accounts_filed_last_day',
      severity: 'info',
      description: `${lateCount} of last ${accountsFilings.length} accounts filings were near end-of-month (possible habitual late filer)`,
      date: accountsFilings[0]?.date ?? null,
    });
  }
}

function checkNoRecentFilings(filings: FilingItem[], profile: CompanyProfile, lookbackMonths: number, anomalies: Anomaly[]): void {
  if (profile.company_status !== 'active') return;

  if (filings.length === 0 && lookbackMonths >= 12) {
    anomalies.push({
      type: 'no_recent_filings',
      severity: 'warning',
      description: `No filings in the last ${lookbackMonths} months despite being an active company`,
      date: null,
    });
  }
}

function checkNameChanges(filings: FilingItem[], anomalies: Anomaly[]): void {
  const nameChanges = filings.filter(f => f.category === 'change-of-name');
  if (nameChanges.length >= 2) {
    anomalies.push({
      type: 'name_change',
      severity: 'info',
      description: `${nameChanges.length} name changes in the lookback period`,
      date: nameChanges[0]?.date ?? null,
    });
  }
}
