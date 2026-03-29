import type { CompanyProfile, OfficerList, FilingHistoryList, ChargeList, CompanyInsolvency } from '../api/types.js';

export type RiskLevel = 'low' | 'medium' | 'high';
export type FlagSeverity = 'info' | 'warning' | 'critical';

export interface RiskFlag {
  flag: string;
  severity: FlagSeverity;
}

export interface RiskSummary {
  overall: RiskLevel;
  flags: RiskFlag[];
  overdue_filings: boolean;
  charges_count: number;
  insolvency_history: boolean;
  director_warning_count: number;
}

interface RiskInput {
  profile: CompanyProfile;
  officers?: OfficerList;
  filings?: FilingHistoryList;
  charges?: ChargeList;
  insolvency?: CompanyInsolvency;
}

export function assessRisk(input: RiskInput): RiskSummary {
  const flags: RiskFlag[] = [];

  assessProfileRisks(input.profile, flags);

  if (input.officers) {
    assessOfficerRisks(input.officers, flags);
  }

  if (input.filings) {
    assessFilingRisks(input.profile, input.filings, flags);
  }

  const chargesCount = input.charges?.items?.length ?? 0;
  if (chargesCount > 0) {
    assessChargeRisks(input.charges!, flags);
  }

  const hasInsolvency = (input.insolvency?.cases?.length ?? 0) > 0;
  if (hasInsolvency) {
    assessInsolvencyRisks(input.insolvency!, flags);
  }

  const overdueFilings = input.profile.accounts?.next_accounts?.overdue === true ||
    input.profile.confirmation_statement?.overdue === true;

  const directorWarnings = flags.filter(
    f => f.flag.toLowerCase().includes('director') || f.flag.toLowerCase().includes('officer')
  ).length;

  const overall = calculateOverallRisk(flags);

  return {
    overall,
    flags,
    overdue_filings: overdueFilings,
    charges_count: chargesCount,
    insolvency_history: hasInsolvency,
    director_warning_count: directorWarnings,
  };
}

function assessProfileRisks(profile: CompanyProfile, flags: RiskFlag[]): void {
  const status = profile.company_status;

  if (status === 'liquidation' || status === 'insolvency-proceedings') {
    flags.push({ flag: `Company is in ${status}`, severity: 'critical' });
  } else if (status === 'administration' || status === 'receivership') {
    flags.push({ flag: `Company is in ${status}`, severity: 'critical' });
  } else if (status === 'dissolved') {
    flags.push({ flag: 'Company is dissolved', severity: 'warning' });
  } else if (status === 'voluntary-arrangement') {
    flags.push({ flag: 'Company is in a voluntary arrangement', severity: 'warning' });
  }

  if (profile.registered_office_is_in_dispute) {
    flags.push({ flag: 'Registered office address is in dispute', severity: 'warning' });
  }

  if (profile.undeliverable_registered_office_address) {
    flags.push({ flag: 'Registered office address is undeliverable', severity: 'warning' });
  }

  if (profile.accounts?.next_accounts?.overdue) {
    flags.push({ flag: 'Accounts are overdue', severity: 'critical' });
  }

  if (profile.confirmation_statement?.overdue) {
    flags.push({ flag: 'Confirmation statement is overdue', severity: 'critical' });
  }

  if (profile.date_of_creation) {
    const ageMonths = monthsSince(profile.date_of_creation);
    if (ageMonths < 6) {
      flags.push({ flag: `Company is very new (${ageMonths} months old)`, severity: 'info' });
    }
  }
}

function assessOfficerRisks(officers: OfficerList, flags: RiskFlag[]): void {
  if (officers.active_count === 0) {
    flags.push({ flag: 'No active officers', severity: 'critical' });
  } else if (officers.active_count === 1) {
    flags.push({ flag: 'Only 1 active officer (single point of failure)', severity: 'info' });
  }

  // Check for high director turnover in recent period
  const recentResignations = officers.items.filter(o => {
    if (!o.resigned_on) return false;
    return monthsSince(o.resigned_on) <= 12;
  });

  if (recentResignations.length >= 3) {
    flags.push({
      flag: `${recentResignations.length} directors resigned in the last 12 months`,
      severity: 'warning',
    });
  }

  // Check for corporate directors (can obscure beneficial ownership)
  const corporateDirectors = officers.items.filter(
    o => !o.resigned_on && o.identification?.identification_type
  );
  if (corporateDirectors.length > 0) {
    flags.push({
      flag: `${corporateDirectors.length} corporate director(s) — may obscure beneficial ownership`,
      severity: 'info',
    });
  }

  // Check for complete board replacement (common in fraudulent takeovers)
  if (officers.active_count === 1 && recentResignations.length >= 2) {
    const activeOfficer = officers.items.find(o => !o.resigned_on);
    if (activeOfficer?.appointed_on && monthsSince(activeOfficer.appointed_on) <= 6) {
      flags.push({
        flag: 'Sole director appointed within 6 months while 2+ directors resigned — possible hostile takeover',
        severity: 'warning',
      });
    }
  }
}

function assessFilingRisks(profile: CompanyProfile, filings: FilingHistoryList, flags: RiskFlag[]): void {
  if (filings.items.length === 0) {
    return;
  }

  // Check for address changes in last 24 months
  const addressChanges = filings.items.filter(f =>
    f.category === 'address' && monthsSince(f.date) <= 24
  );
  if (addressChanges.length >= 3) {
    flags.push({
      flag: `${addressChanges.length} registered address changes in the last 24 months`,
      severity: 'warning',
    });
  }

  // Check for late filing pattern (accounts filed in last 7 days before deadline)
  if (profile.accounts?.last_accounts?.period_end_on && profile.accounts.accounting_reference_date) {
    const lastAccountsDate = filings.items.find(f => f.category === 'accounts')?.date;
    if (lastAccountsDate && profile.accounts.last_accounts.period_end_on) {
      const periodEnd = new Date(profile.accounts.last_accounts.period_end_on);
      const filedDate = new Date(lastAccountsDate);
      // Private companies get 9 months from period end
      const deadline = new Date(periodEnd);
      deadline.setMonth(deadline.getMonth() + 9);
      const daysBeforeDeadline = (deadline.getTime() - filedDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysBeforeDeadline >= 0 && daysBeforeDeadline <= 7) {
        flags.push({
          flag: 'Last accounts filed within 7 days of deadline',
          severity: 'info',
        });
      }
    }
  }
}

function assessChargeRisks(charges: ChargeList, flags: RiskFlag[]): void {
  const outstanding = charges.items.filter(c => c.status === 'outstanding');
  if (outstanding.length > 0) {
    flags.push({
      flag: `${outstanding.length} outstanding charge(s)/mortgage(s)`,
      severity: 'info',
    });
  }

  if (outstanding.length >= 5) {
    flags.push({
      flag: 'High number of outstanding charges (5+)',
      severity: 'warning',
    });
  }
}

function assessInsolvencyRisks(insolvency: CompanyInsolvency, flags: RiskFlag[]): void {
  for (const c of insolvency.cases) {
    flags.push({
      flag: `Insolvency case: ${c.type.replace(/-/g, ' ')}`,
      severity: 'critical',
    });
  }
}

function calculateOverallRisk(flags: RiskFlag[]): RiskLevel {
  const criticalCount = flags.filter(f => f.severity === 'critical').length;
  const warningCount = flags.filter(f => f.severity === 'warning').length;

  if (criticalCount >= 1) return 'high';
  if (warningCount >= 2) return 'high';
  if (warningCount >= 1) return 'medium';
  return 'low';
}

function monthsSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}
