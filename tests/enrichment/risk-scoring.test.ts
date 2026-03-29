import { describe, it, expect } from 'vitest';
import { assessRisk } from '../../src/enrichment/risk-scoring.js';
import type { CompanyProfile, OfficerList, FilingHistoryList, ChargeList, CompanyInsolvency } from '../../src/api/types.js';

function makeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    can_file: true,
    company_name: 'TEST LTD',
    company_number: '12345678',
    company_status: 'active',
    date_of_creation: '2015-01-01',
    links: { self: '/company/12345678' },
    type: 'ltd',
    ...overrides,
  };
}

function makeOfficerList(overrides: Partial<OfficerList> = {}): OfficerList {
  return {
    active_count: 2,
    items: [
      { name: 'SMITH, John', officer_role: 'director', appointed_on: '2015-01-01', links: { self: '/o/1' } },
      { name: 'DOE, Jane', officer_role: 'director', appointed_on: '2016-06-01', links: { self: '/o/2' } },
    ],
    items_per_page: 35,
    resigned_count: 0,
    start_index: 0,
    total_results: 2,
    ...overrides,
  };
}

describe('assessRisk', () => {
  it('returns low risk for a healthy active company', () => {
    const result = assessRisk({
      profile: makeProfile(),
      officers: makeOfficerList(),
    });
    expect(result.overall).toBe('low');
    expect(result.overdue_filings).toBe(false);
    expect(result.insolvency_history).toBe(false);
  });

  it('flags dissolved company as warning', () => {
    const result = assessRisk({ profile: makeProfile({ company_status: 'dissolved' }) });
    expect(result.flags.some(f => f.flag.includes('dissolved'))).toBe(true);
    expect(result.overall).toBe('medium');
  });

  it('flags liquidation as critical', () => {
    const result = assessRisk({ profile: makeProfile({ company_status: 'liquidation' }) });
    const flag = result.flags.find(f => f.flag.includes('liquidation'));
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('critical');
    expect(result.overall).toBe('high');
  });

  it('flags overdue accounts as critical', () => {
    const result = assessRisk({
      profile: makeProfile({
        accounts: { next_accounts: { overdue: true, due_on: '2025-01-01' } },
      }),
    });
    expect(result.overdue_filings).toBe(true);
    expect(result.flags.some(f => f.flag === 'Accounts are overdue')).toBe(true);
    expect(result.overall).toBe('high');
  });

  it('flags overdue confirmation statement', () => {
    const result = assessRisk({
      profile: makeProfile({
        confirmation_statement: { overdue: true, next_due: '2025-01-01', next_made_up_to: '2025-01-01' },
      }),
    });
    expect(result.overdue_filings).toBe(true);
    expect(result.flags.some(f => f.flag.includes('Confirmation statement'))).toBe(true);
  });

  it('flags no active officers as critical', () => {
    const result = assessRisk({
      profile: makeProfile(),
      officers: makeOfficerList({ active_count: 0, items: [] }),
    });
    expect(result.flags.some(f => f.flag === 'No active officers')).toBe(true);
    expect(result.overall).toBe('high');
  });

  it('flags rapid director resignations', () => {
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 3);
    const dateStr = recentDate.toISOString().split('T')[0];

    const result = assessRisk({
      profile: makeProfile(),
      officers: makeOfficerList({
        resigned_count: 3,
        items: [
          { name: 'A', officer_role: 'director', resigned_on: dateStr, links: { self: '/o/1' } },
          { name: 'B', officer_role: 'director', resigned_on: dateStr, links: { self: '/o/2' } },
          { name: 'C', officer_role: 'director', resigned_on: dateStr, links: { self: '/o/3' } },
        ],
      }),
    });
    expect(result.flags.some(f => f.flag.includes('directors resigned'))).toBe(true);
    expect(result.director_warning_count).toBeGreaterThan(0);
  });

  it('flags outstanding charges', () => {
    const charges: ChargeList = {
      items: [
        { charge_number: 1, id: 'c1', status: 'outstanding', etag: 'x' },
        { charge_number: 2, id: 'c2', status: 'satisfied', etag: 'y' },
      ],
      total_count: 2,
    };
    const result = assessRisk({ profile: makeProfile(), charges });
    expect(result.charges_count).toBe(2);
    expect(result.flags.some(f => f.flag.includes('outstanding charge'))).toBe(true);
  });

  it('flags insolvency cases', () => {
    const insolvency: CompanyInsolvency = {
      cases: [
        {
          type: 'creditors-voluntary-liquidation',
          dates: [{ date: '2024-01-01', type: 'wound-up-on' }],
          practitioners: [{ name: 'Mr IP', address: [] }],
        },
      ],
    };
    const result = assessRisk({ profile: makeProfile(), insolvency });
    expect(result.insolvency_history).toBe(true);
    expect(result.flags.some(f => f.flag.includes('creditors voluntary liquidation'))).toBe(true);
    expect(result.overall).toBe('high');
  });

  it('flags address disputes', () => {
    const result = assessRisk({
      profile: makeProfile({ registered_office_is_in_dispute: true }),
    });
    expect(result.flags.some(f => f.flag.includes('dispute'))).toBe(true);
  });

  it('flags undeliverable address', () => {
    const result = assessRisk({
      profile: makeProfile({ undeliverable_registered_office_address: true }),
    });
    expect(result.flags.some(f => f.flag.includes('undeliverable'))).toBe(true);
  });

  it('calculates high risk with 2+ warnings', () => {
    const result = assessRisk({
      profile: makeProfile({
        company_status: 'dissolved',
        registered_office_is_in_dispute: true,
      }),
    });
    expect(result.overall).toBe('high');
  });

  it('calculates medium risk with 1 warning', () => {
    const result = assessRisk({
      profile: makeProfile({ company_status: 'dissolved' }),
    });
    expect(result.overall).toBe('medium');
  });

  it('flags complete board replacement as possible hostile takeover', () => {
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 2);
    const resignDate = recentDate.toISOString().split('T')[0];
    const appointDate = new Date();
    appointDate.setMonth(appointDate.getMonth() - 1);
    const appointStr = appointDate.toISOString().split('T')[0];

    const result = assessRisk({
      profile: makeProfile(),
      officers: makeOfficerList({
        active_count: 1,
        resigned_count: 2,
        items: [
          { name: 'NEW, Person', officer_role: 'director', appointed_on: appointStr, links: { self: '/o/4' } },
          { name: 'OLD, A', officer_role: 'director', resigned_on: resignDate, links: { self: '/o/1' } },
          { name: 'OLD, B', officer_role: 'director', resigned_on: resignDate, links: { self: '/o/2' } },
        ],
      }),
    });
    expect(result.flags.some(f => f.flag.includes('hostile takeover'))).toBe(true);
  });

  it('flags frequent address changes', () => {
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 6);
    const dateStr = recentDate.toISOString().split('T')[0];

    const filings: FilingHistoryList = {
      items: [
        { category: 'address', date: dateStr, description: 'change', transaction_id: 't1', type: 'AD01' },
        { category: 'address', date: dateStr, description: 'change', transaction_id: 't2', type: 'AD01' },
        { category: 'address', date: dateStr, description: 'change', transaction_id: 't3', type: 'AD01' },
      ],
      items_per_page: 25,
      start_index: 0,
      total_count: 3,
    };
    const result = assessRisk({ profile: makeProfile(), filings });
    expect(result.flags.some(f => f.flag.includes('address changes'))).toBe(true);
  });
});
